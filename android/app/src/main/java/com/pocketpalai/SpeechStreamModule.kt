package com.pocketpal

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeSpeechStreamSpec

/**
 * One uninterrupted output stream for one spoken reply.
 *
 * The speech library plays every clip through a freshly built static track, so
 * each piece of a streamed reply pays for a new device output, a new focus
 * request and a new start — and the listener hears a hole where the pieces meet.
 * A stream track is built once, left open, and appended to as samples arrive:
 * the next chunk is already in the buffer before the current one runs out, so
 * the reply has no boundary in it at all.
 */
@ReactModule(name = NativeSpeechStreamSpec.NAME)
class SpeechStreamModule(reactContext: ReactApplicationContext) :
    NativeSpeechStreamSpec(reactContext) {

  override fun getName(): String = NativeSpeechStreamSpec.NAME

  companion object {
    /** The volume the system player drops to while another app asks to duck. */
    private const val DUCKED_VOLUME = 0.2f

    /**
     * Samples per blocking write. A stream write is only as interruptible as its
     * longest slice, and a barge-in has to land before the stale words are heard.
     */
    private const val WRITE_SLICE_SAMPLES = 960

    private const val POLL_MS = 20L

    /** Room granted to a tail the device is still playing out. */
    private const val TAIL_GRACE_MS = 1500L
  }

  private val audioManager: AudioManager by lazy {
    reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  }

  @Volatile private var session: Stream? = null

  override fun begin(sampleRate: Double, channels: Double, ducking: Boolean, promise: Promise) {
    val rate = sampleRate.toInt()
    val count = channels.toInt()
    if (rate < 8000 || rate > 96000 || count < 1 || count > 2) {
      promise.resolve(false)
      return
    }
    // A reply that was never closed must not keep holding the output.
    session?.abort()
    val stream = Stream(rate, count, ducking)
    if (!stream.start()) {
      promise.resolve(false)
      return
    }
    session = stream
    promise.resolve(true)
  }

  override fun write(base64Pcm16: String, promise: Promise) {
    // Decoded here rather than on the audio thread: a caller hands whole
    // chunks, so the writer never sees half a frame.
    val bytes = try {
      Base64.decode(base64Pcm16, Base64.DEFAULT)
    } catch (e: Exception) {
      promise.reject("speech_stream", "undecodable pcm", e)
      return
    }
    promise.resolve(session?.enqueue(bytes) ?: false)
  }

  override fun end(promise: Promise) {
    val stream = session
    if (stream == null) {
      promise.resolve(emptyStats())
      return
    }
    // The session stays reachable: a listener who interrupts during the tail
    // still has to be able to silence it.
    stream.close(promise)
  }

  override fun abort(promise: Promise) {
    promise.resolve(session?.abort() ?: false)
  }

  override fun invalidate() {
    super.invalidate()
    session?.abort()
    session = null
  }

  private fun emptyStats(): WritableMap = Arguments.createMap().apply {
    putInt("underruns", -1)
    putDouble("dryMs", 0.0)
    putDouble("framesWritten", 0.0)
    putDouble("framesPlayed", 0.0)
    putDouble("leadMs", 0.0)
  }

  /**
   * A single open track, the thread that feeds it, and the numbers that say
   * whether it starved. The thread owns every `AudioTrack` call, so a reply can
   * never be heard twice or torn down while a write is in flight.
   */
  private inner class Stream(
    private val sampleRate: Int,
    private val channels: Int,
    private val ducking: Boolean,
  ) {
    private val lock = Any()
    private val queue = ArrayDeque<ByteArray>()

    private var track: AudioTrack? = null

    /** Set when JS has said the reply is over; the queue may still hold audio. */
    private var closing = false

    /** Set by [abort]; the stream stops paying attention to everything else. */
    private var aborted = false

    /** Set once the track is released, so exactly one caller settles. */
    private var settled = false

    private var endPromise: Promise? = null

    @Volatile private var framesWritten = 0L

    /** Frames reached when the track was released, kept for a late `end`. */
    @Volatile private var playedFramesFinal = 0L

    /** Wall time the device had caught up with everything written. Writer thread only. */
    @Volatile private var dryMs = 0.0

    private var openedAtMs = 0L
    private var playedAtMs = 0L
    private var underrunsAtStart = -1

    private var focusRequest: AudioFocusRequest? = null
    private var focusListener: AudioManager.OnAudioFocusChangeListener? = null
    private var hasFocus = false

    private val frameBytes = 2 * channels

    /**
     * Volume only. A stream track must not be paused from the focus callback:
     * the writer is normally parked inside a blocking `write`, and freezing the
     * buffer would strand it there with the reply never finishing.
     */
    private val focusChange = AudioManager.OnAudioFocusChangeListener { change ->
      when (change) {
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> volume(DUCKED_VOLUME)
        AudioManager.AUDIOFOCUS_GAIN -> volume(1f)
        else -> {}
      }
    }

    private fun volume(value: Float) {
      synchronized(lock) {
        try {
          track?.setVolume(value)
        } catch (_: Exception) {
          // Already released by the writer: the reply is ending anyway.
        }
      }
    }

    /** @return false when this device will not give us a stream track at all. */
    fun start(): Boolean {
      val channelConfig = if (channels == 1) {
        AudioFormat.CHANNEL_OUT_MONO
      } else {
        AudioFormat.CHANNEL_OUT_STEREO
      }
      val minBuffer = AudioTrack.getMinBufferSize(
        sampleRate,
        channelConfig,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      if (minBuffer <= 0) {
        return false
      }
      val built = try {
        AudioTrack.Builder()
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build(),
          )
          .setAudioFormat(
            AudioFormat.Builder()
              .setSampleRate(sampleRate)
              .setChannelMask(channelConfig)
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .build(),
          )
          // Three seconds, which is the longest buffer the feed is ever asked
          // to hold before it starts a reply: the device's own ring must never
          // be the reason a piece waits to be written.
          .setBufferSizeInBytes(maxOf(minBuffer, sampleRate * 3 * channels * 2))
          .setTransferMode(AudioTrack.MODE_STREAM)
          .build()
      } catch (_: Exception) {
        return false
      }
      if (ducking) {
        requestFocus()
      }
      synchronized(lock) {
        track = built
        underrunsAtStart = readUnderruns(built)
        openedAtMs = SystemClock.elapsedRealtime()
      }
      Thread {
        try {
          pump(built)
        } finally {
          finish(built)
        }
      }
        .apply { isDaemon = true; name = "SpeechStream" }
        .start()
      return true
    }

    fun enqueue(bytes: ByteArray): Boolean {
      synchronized(lock) {
        if (aborted || closing || settled) {
          return false
        }
        if (bytes.isEmpty()) {
          return true
        }
        if (bytes.size % frameBytes != 0) {
          // Half a frame would shift every sample that follows it and turn the
          // rest of the reply into noise, so a torn chunk is dropped whole.
          return false
        }
        queue.addLast(bytes)
        lock.notifyAll()
        return true
      }
    }

    fun close(promise: Promise) {
      var answerNow = false
      synchronized(lock) {
        if (settled || endPromise != null) {
          answerNow = true
        } else {
          endPromise = promise
          closing = true
          lock.notifyAll()
        }
      }
      // Either the writer has gone or another caller is already owed the real
      // numbers, so nothing here would ever hand this promise back: answer it
      // from what the stream has played rather than leave it hanging.
      if (answerNow) {
        promise.resolve(buildStats(-1, framesPlayed()))
      }
    }

    /** @return true when a live stream was stopped, so silence is expected. */
    fun abort(): Boolean {
      val current: AudioTrack?
      val live: Boolean
      synchronized(lock) {
        live = !settled
        aborted = true
        closing = true
        queue.clear()
        current = track
        lock.notifyAll()
      }
      // Done from the interrupting thread so a barge-in is silent at once
      // instead of as soon as the writer finishes its slice. `stop` is what
      // frees a thread blocked inside `write`; `pause` alone would leave it
      // waiting for buffer space that will never come.
      try {
        current?.pause()
        current?.stop()
      } catch (_: Exception) {
        // The writer is already tearing the track down.
      }
      // A stream whose writer has gone settled its own promise on its way out,
      // so there is nothing left to hand back here.
      return live
    }

    private fun readUnderruns(track: AudioTrack): Int {
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        try {
          track.underrunCount
        } catch (_: Exception) {
          -1
        }
      } else {
        -1
      }
    }

    /**
     * Frames the device has already played. Zero until the track starts, so the
     * silence kept while the first piece is still being synthesized is never
     * counted as a gap.
     */
    private fun headFrames(track: AudioTrack): Long {
      return try {
        track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
      } catch (_: Exception) {
        0L
      }
    }

    private fun framesPlayed(): Double {
      val current = synchronized(lock) { track }
      return if (current != null) headFrames(current).toDouble()
      else playedFramesFinal.toDouble()
    }

    private fun pump(track: AudioTrack) {
      var playing = false
      var checkedAtMs = SystemClock.elapsedRealtime()

      while (true) {
        val stopped: Boolean
        val chunk: ByteArray?
        synchronized(lock) {
          while (queue.isEmpty() && !aborted && !closing) {
            lock.wait(POLL_MS)
            val now = SystemClock.elapsedRealtime()
            if (playing && headFrames(track) >= framesWritten) {
              dryMs += (now - checkedAtMs).toDouble()
            }
            checkedAtMs = now
          }
          stopped = aborted
          chunk = if (aborted) null else queue.pollFirst()
        }
        if (stopped) {
          break
        }
        if (chunk != null) {
          if (!playing) {
            playing = true
            playedAtMs = SystemClock.elapsedRealtime()
            try {
              track.play()
            } catch (_: Exception) {
              break
            }
          }
          if (!writeAll(track, chunk)) {
            break
          }
          continue
        }
        // Queue empty and the reply is over.
        val remaining = framesWritten - headFrames(track)
        if (remaining > 0) {
          val deadline = SystemClock.elapsedRealtime() +
            (remaining * 1000L) / sampleRate + TAIL_GRACE_MS
          while (headFrames(track) < framesWritten &&
            SystemClock.elapsedRealtime() < deadline &&
            !synchronized(lock) { aborted }
          ) {
            Thread.sleep(POLL_MS)
          }
        }
        break
      }
    }

    /**
     * Runs whether the loop drained, was interrupted or threw: a reply may never
     * be left waiting on a promise nobody means to settle.
     */
    private fun finish(track: AudioTrack) {
      val underruns = if (underrunsAtStart < 0) {
        -1
      } else {
        (readUnderruns(track) - underrunsAtStart).coerceAtLeast(0)
      }
      val playedFrames = if (playedAtMs == 0L) 0L else headFrames(track)
      playedFramesFinal = playedFrames
      val stats = statsOf(underruns, dryMs, framesWritten, playedFrames.toDouble(), leadMs())

      val pending = synchronized(lock) {
        val promise = endPromise
        endPromise = null
        settled = true
        try {
          track.release()
        } catch (_: Exception) {
          // Already released elsewhere; the stream is over either way.
        }
        this.track = null
        queue.clear()
        promise
      }
      abandonFocus()
      pending?.resolve(stats)
    }

    /** @return false when the stream was stopped from underneath the write. */
    private fun writeAll(track: AudioTrack, bytes: ByteArray): Boolean {
      val sliceBytes = maxOf(1, WRITE_SLICE_SAMPLES / channels) * frameBytes
      var offset = 0
      while (offset < bytes.size) {
        if (synchronized(lock) { aborted || settled }) {
          return false
        }
        val size = minOf(sliceBytes, bytes.size - offset)
        val written = try {
          track.write(bytes, offset, size)
        } catch (_: Exception) {
          return false
        }
        if (written <= 0) {
          return false
        }
        offset += written
        framesWritten += (written / frameBytes).toLong()
      }
      return true
    }

    private fun leadMs(): Double =
      if (playedAtMs == 0L || openedAtMs == 0L) 0.0 else (playedAtMs - openedAtMs).toDouble()

    private fun buildStats(underruns: Int, framesPlayed: Double): WritableMap =
      statsOf(underruns, dryMs, framesWritten, framesPlayed, leadMs())

    private fun statsOf(
      underruns: Int,
      dryMs: Double,
      framesWritten: Long,
      framesPlayed: Double,
      leadMs: Double,
    ): WritableMap = Arguments.createMap().apply {
      putInt("underruns", underruns)
      putDouble("dryMs", dryMs)
      putDouble("framesWritten", framesWritten.toDouble())
      putDouble("framesPlayed", framesPlayed)
      putDouble("leadMs", leadMs)
    }

    private fun requestFocus() {
      val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val listener = focusChange
        focusListener = listener
        val request = AudioFocusRequest.Builder(
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
        )
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build(),
          )
          .setOnAudioFocusChangeListener(listener)
          .build()
        focusRequest = request
        audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      } else {
        @Suppress("DEPRECATION")
        val listener = focusChange
        focusListener = listener
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(
          listener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
        ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      }
      hasFocus = granted
      if (!granted) {
        // Nothing to hand back, and the callback must not outlive the attempt.
        focusListener = null
        focusRequest = null
      }
    }

    private fun abandonFocus() {
      if (!hasFocus) {
        return
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        focusListener?.let { audioManager.abandonAudioFocus(it) }
      }
      focusRequest = null
      focusListener = null
      hasFocus = false
    }
  }
}
