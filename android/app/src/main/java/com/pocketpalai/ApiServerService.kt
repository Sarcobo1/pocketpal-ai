package com.pocketpal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class ApiServerService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null

  companion object {
    const val CHANNEL_ID = "pocketpal_api_server"
    const val NOTIFICATION_ID = 4201
    const val ACTION_START = "com.pocketpal.API_SERVER_START"
    const val ACTION_UPDATE = "com.pocketpal.API_SERVER_UPDATE"
    const val ACTION_STOP = "com.pocketpal.API_SERVER_STOP"
    const val EXTRA_MODEL_NAME = "modelName"
    const val EXTRA_RAM_LOADED = "ramLoaded"
    const val EXTRA_PORT = "port"

    fun start(context: Context, modelName: String, port: Int, ramLoaded: Boolean) {
      val intent = Intent(context, ApiServerService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_MODEL_NAME, modelName)
        putExtra(EXTRA_PORT, port)
        putExtra(EXTRA_RAM_LOADED, ramLoaded)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun update(context: Context, modelName: String, port: Int, ramLoaded: Boolean) {
      val intent = Intent(context, ApiServerService::class.java).apply {
        action = ACTION_UPDATE
        putExtra(EXTRA_MODEL_NAME, modelName)
        putExtra(EXTRA_PORT, port)
        putExtra(EXTRA_RAM_LOADED, ramLoaded)
      }
      context.startService(intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, ApiServerService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_START, ACTION_UPDATE -> {
        val modelName = intent.getStringExtra(EXTRA_MODEL_NAME) ?: "Model"
        val port = intent.getIntExtra(EXTRA_PORT, 11434)
        val ramLoaded = intent.getBooleanExtra(EXTRA_RAM_LOADED, false)
        val notification = buildNotification(modelName, port, ramLoaded)
        if (intent.action == ACTION_START) {
          acquireWakeLock()
          startForeground(NOTIFICATION_ID, notification)
        } else {
          val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          nm.notify(NOTIFICATION_ID, notification)
        }
      }
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    releaseWakeLock()
    super.onDestroy()
  }

  private fun acquireWakeLock() {
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PocketPal::ApiServerWakeLock")
      wakeLock?.setReferenceCounted(false)
    }
    if (wakeLock?.isHeld == false) {
      wakeLock?.acquire(60 * 60 * 1000L) // 1 hour renewable
    }
  }

  private fun releaseWakeLock() {
    if (wakeLock?.isHeld == true) {
      wakeLock?.release()
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "PocketPal Model API Server",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Model API serveri fonda ishlayotganini ko'rsatadi"
      }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(modelName: String, port: Int, ramLoaded: Boolean): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val ramText = if (ramLoaded) "RAMda faol" else "Kutish rejimi (RAM bo'shatilgan)"
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Model API Online: $modelName")
      .setContentText("Port $port · $ramText")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setSilent(true)
      .build()
  }
}
