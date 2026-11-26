package com.pocketpal

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ApiServerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ApiServerModule"

  private data class HttpReply(
    val statusCode: Int,
    val headers: Map<String, String>,
    val body: String
  )

  private class StreamChannel(val socket: Socket, val out: OutputStream) {
    @Volatile
    var closed = false
  }

  private var serverSocket: ServerSocket? = null
  private var acceptThread: Thread? = null
  private var executor: ExecutorService? = null
  @Volatile
  private var isRunning = false
  private var currentPort = 11434

  private val pendingResponses = ConcurrentHashMap<String, CompletableFuture<HttpReply>>()
  private val activeStreams = ConcurrentHashMap<String, StreamChannel>()

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for RN NativeEventEmitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for RN NativeEventEmitter
  }

  @ReactMethod
  fun checkInternetConnectivity(promise: Promise) {
    try {
      val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val network = cm.activeNetwork
      val caps = if (network != null) cm.getNetworkCapabilities(network) else null
      val hasInternet = caps != null &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
      val anyTransport = caps != null && (
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
          caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
          caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
          caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        )
      val networkType = when {
        caps == null -> "none"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        else -> "other"
      }
      val map = Arguments.createMap().apply {
        putBoolean("isConnected", hasInternet || (anyTransport && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)))
        putString("networkType", networkType)
        putString("localIp", getLocalIpv4Address())
      }
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("NETWORK_CHECK_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun openNetworkSettings() {
    try {
      val intent = Intent(Settings.ACTION_WIRELESS_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
    } catch (e: Exception) {
      val fallback = Intent(Settings.ACTION_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(fallback)
    }
  }

  @ReactMethod
  fun startServer(port: Int, modelName: String, promise: Promise) {
    if (isRunning) {
      val result = Arguments.createMap().apply {
        putInt("port", currentPort)
        putString("localIp", getLocalIpv4Address())
      }
      promise.resolve(result)
      return
    }
    try {
      val socket = ServerSocket(port)
      serverSocket = socket
      currentPort = socket.localPort
      isRunning = true
      executor = Executors.newCachedThreadPool()

      ApiServerService.start(reactContext, modelName, currentPort, true)

      acceptThread = Thread {
        while (isRunning && !socket.isClosed) {
          try {
            val client = socket.accept()
            executor?.submit { handleClient(client) }
          } catch (e: Exception) {
            if (isRunning) {
              // Ignore accept error on stop
            }
          }
        }
      }.apply {
        name = "PocketPal-ApiServer-Accept"
        isDaemon = true
        start()
      }

      val result = Arguments.createMap().apply {
        putInt("port", currentPort)
        putString("localIp", getLocalIpv4Address())
      }
      promise.resolve(result)
    } catch (e: Exception) {
      isRunning = false
      promise.reject("SERVER_START_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopServer(promise: Promise) {
    try {
      isRunning = false
      pendingResponses.values.forEach { it.cancel(true) }
      pendingResponses.clear()
      activeStreams.values.forEach {
        it.closed = true
        try {
          it.socket.close()
        } catch (_: Exception) {}
      }
      activeStreams.clear()
      try {
        serverSocket?.close()
      } catch (_: Exception) {}
      serverSocket = null
      executor?.shutdownNow()
      executor = null
      ApiServerService.stop(reactContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SERVER_STOP_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun updateServiceNotification(modelName: String, ramLoaded: Boolean) {
    if (isRunning) {
      ApiServerService.update(reactContext, modelName, currentPort, ramLoaded)
    }
  }

  @ReactMethod
  fun sendResponse(requestId: String, statusCode: Int, headersJson: String, body: String) {
    val future = pendingResponses.remove(requestId) ?: return
    val headers = mutableMapOf<String, String>()
    try {
      val obj = JSONObject(headersJson)
      val keys = obj.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        headers[k] = obj.optString(k, "")
      }
    } catch (_: Exception) {}
    future.complete(HttpReply(statusCode, headers, body))
  }

  @ReactMethod
  fun startStream(requestId: String, statusCode: Int, headersJson: String) {
    // Signal handleClient that this request is streaming; handled via sendStreamChunk/endStream
    val channel = activeStreams[requestId] ?: return
    try {
      val sb = StringBuilder()
      sb.append("HTTP/1.1 $statusCode ${reasonPhrase(statusCode)}\r\n")
      sb.append("Access-Control-Allow-Origin: *\r\n")
      sb.append("Access-Control-Allow-Headers: Content-Type, Authorization\r\n")
      sb.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
      sb.append("Content-Type: text/event-stream; charset=utf-8\r\n")
      sb.append("Cache-Control: no-cache\r\n")
      sb.append("Connection: close\r\n")
      try {
        val obj = JSONObject(headersJson)
        val keys = obj.keys()
        while (keys.hasNext()) {
          val k = keys.next()
          if (!k.equals("Content-Type", ignoreCase = true)) {
            sb.append("$k: ${obj.optString(k, "")}\r\n")
          }
        }
      } catch (_: Exception) {}
      sb.append("\r\n")
      synchronized(channel) {
        if (!channel.closed) {
          channel.out.write(sb.toString().toByteArray(StandardCharsets.UTF_8))
          channel.out.flush()
        }
      }
      // Unblock the waiting future with a sentinel indicating streaming took ownership of socket
      pendingResponses.remove(requestId)?.complete(HttpReply(-1, emptyMap(), ""))
    } catch (_: Exception) {
      endStream(requestId)
    }
  }

  @ReactMethod
  fun sendStreamChunk(requestId: String, chunk: String) {
    val channel = activeStreams[requestId] ?: return
    try {
      synchronized(channel) {
        if (!channel.closed) {
          channel.out.write(chunk.toByteArray(StandardCharsets.UTF_8))
          channel.out.flush()
        }
      }
    } catch (_: Exception) {
      endStream(requestId)
    }
  }

  @ReactMethod
  fun endStream(requestId: String) {
    val channel = activeStreams.remove(requestId) ?: return
    synchronized(channel) {
      channel.closed = true
      try {
        channel.out.flush()
      } catch (_: Exception) {}
      try {
        channel.socket.close()
      } catch (_: Exception) {}
    }
  }

  private fun handleClient(socket: Socket) {
    var keepSocketOpenForStream = false
    val requestId = UUID.randomUUID().toString()
    try {
      socket.soTimeout = 15000
      val input = BufferedInputStream(socket.getInputStream())
      val out = socket.getOutputStream()

      // Read HTTP headers up to \r\n\r\n
      val headerBytes = ArrayList<Byte>(1024)
      var prev3 = 0; var prev2 = 0; var prev1 = 0
      while (true) {
        val b = input.read()
        if (b == -1) break
        headerBytes.add(b.toByte())
        if (prev3 == '\r'.code && prev2 == '\n'.code && prev1 == '\r'.code && b == '\n'.code) {
          break
        }
        prev3 = prev2; prev2 = prev1; prev1 = b
        if (headerBytes.size > 65536) break
      }
      if (headerBytes.isEmpty()) {
        socket.close()
        return
      }

      val headerStr = String(headerBytes.toByteArray(), StandardCharsets.UTF_8)
      val lines = headerStr.split("\r\n")
      val requestLine = lines.firstOrNull() ?: ""
      val parts = requestLine.split(" ")
      if (parts.size < 2) {
        writeSimpleResponse(out, 400, "{\"error\":{\"message\":\"Bad Request\"}}")
        socket.close()
        return
      }
      val method = parts[0].uppercase()
      val fullPath = parts[1]
      val path = fullPath.substringBefore("?")

      val headersMap = Arguments.createMap()
      var contentLength = 0
      for (i in 1 until lines.size) {
        val line = lines[i]
        if (line.isBlank()) continue
        val idx = line.indexOf(':')
        if (idx > 0) {
          val name = line.substring(0, idx).trim().lowercase()
          val value = line.substring(idx + 1).trim()
          headersMap.putString(name, value)
          if (name == "content-length") {
            contentLength = value.toIntOrNull() ?: 0
          }
        }
      }

      if (method == "OPTIONS") {
        val cors = "HTTP/1.1 204 No Content\r\n" +
          "Access-Control-Allow-Origin: *\r\n" +
          "Access-Control-Allow-Headers: Content-Type, Authorization\r\n" +
          "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
          "Connection: close\r\n\r\n"
        out.write(cors.toByteArray(StandardCharsets.UTF_8))
        out.flush()
        socket.close()
        return
      }

      var body = ""
      if (contentLength > 0 && contentLength <= 10 * 1024 * 1024) {
        val buf = ByteArray(contentLength)
        var readTotal = 0
        while (readTotal < contentLength) {
          val n = input.read(buf, readTotal, contentLength - readTotal)
          if (n == -1) break
          readTotal += n
        }
        body = String(buf, 0, readTotal, StandardCharsets.UTF_8)
      }

      val future = CompletableFuture<HttpReply>()
      pendingResponses[requestId] = future
      activeStreams[requestId] = StreamChannel(socket, out)

      val eventPayload = Arguments.createMap().apply {
        putString("requestId", requestId)
        putString("method", method)
        putString("path", path)
        putMap("headers", headersMap)
        putString("body", body)
      }

      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("ApiServerRequest", eventPayload)

      val reply = future.get(180, TimeUnit.SECONDS)
      if (reply.statusCode == -1) {
        // Streaming took over the socket
        keepSocketOpenForStream = true
        return
      }

      activeStreams.remove(requestId)
      val bodyBytes = reply.body.toByteArray(StandardCharsets.UTF_8)
      val sb = StringBuilder()
      sb.append("HTTP/1.1 ${reply.statusCode} ${reasonPhrase(reply.statusCode)}\r\n")
      sb.append("Access-Control-Allow-Origin: *\r\n")
      sb.append("Access-Control-Allow-Headers: Content-Type, Authorization\r\n")
      sb.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
      var hasContentType = false
      for ((k, v) in reply.headers) {
        if (k.equals("content-type", ignoreCase = true)) hasContentType = true
        sb.append("$k: $v\r\n")
      }
      if (!hasContentType) {
        sb.append("Content-Type: application/json; charset=utf-8\r\n")
      }
      sb.append("Content-Length: ${bodyBytes.size}\r\n")
      sb.append("Connection: close\r\n\r\n")
      out.write(sb.toString().toByteArray(StandardCharsets.UTF_8))
      out.write(bodyBytes)
      out.flush()
    } catch (e: Exception) {
      pendingResponses.remove(requestId)
      activeStreams.remove(requestId)
      try {
        writeSimpleResponse(socket.getOutputStream(), 504, "{\"error\":{\"message\":\"Gateway Timeout or Error\"}}")
      } catch (_: Exception) {}
    } finally {
      if (!keepSocketOpenForStream) {
        try {
          socket.close()
        } catch (_: Exception) {}
      }
    }
  }

  private fun writeSimpleResponse(out: OutputStream, status: Int, jsonBody: String) {
    val bytes = jsonBody.toByteArray(StandardCharsets.UTF_8)
    val head = "HTTP/1.1 $status ${reasonPhrase(status)}\r\n" +
      "Access-Control-Allow-Origin: *\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      "Content-Length: ${bytes.size}\r\n" +
      "Connection: close\r\n\r\n"
    out.write(head.toByteArray(StandardCharsets.UTF_8))
    out.write(bytes)
    out.flush()
  }

  private fun reasonPhrase(code: Int): String = when (code) {
    200 -> "OK"
    204 -> "No Content"
    400 -> "Bad Request"
    401 -> "Unauthorized"
    404 -> "Not Found"
    405 -> "Method Not Allowed"
    500 -> "Internal Server Error"
    503 -> "Service Unavailable"
    504 -> "Gateway Timeout"
    else -> "OK"
  }

  private fun getLocalIpv4Address(): String {
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces()
      var fallbackIp: String? = null
      while (interfaces.hasMoreElements()) {
        val intf = interfaces.nextElement()
        if (!intf.isUp || intf.isLoopback) continue
        val addrs = intf.inetAddresses
        while (addrs.hasMoreElements()) {
          val addr = addrs.nextElement()
          if (addr is Inet4Address && !addr.isLoopbackAddress) {
            val host = addr.hostAddress ?: continue
            if (intf.name.startsWith("wlan") || intf.name.startsWith("ap")) {
              return host
            }
            if (fallbackIp == null) fallbackIp = host
          }
        }
      }
      return fallbackIp ?: "127.0.0.1"
    } catch (_: Exception) {
      return "127.0.0.1"
    }
  }

  @ReactMethod
  fun saveFileToDownloads(
    sourcePath: String,
    fileName: String,
    mimeType: String,
    promise: Promise
  ) {
    try {
      val cleanPath = sourcePath.removePrefix("file://")
      val srcFile = File(cleanPath)
      if (!srcFile.exists()) {
        promise.reject("FILE_NOT_FOUND", "Source file does not exist: $cleanPath")
        return
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = reactContext.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, fileName)
          put(MediaStore.Downloads.MIME_TYPE, mimeType)
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("MediaStore insert returned null")

        try {
          resolver.openOutputStream(uri)?.use { out ->
            FileInputStream(srcFile).use { input ->
              input.copyTo(out)
            }
          } ?: throw IllegalStateException("Unable to open MediaStore output stream")

          values.clear()
          values.put(MediaStore.Downloads.IS_PENDING, 0)
          resolver.update(uri, values, null, null)
          promise.resolve("Download/$fileName")
        } catch (e: Exception) {
          resolver.delete(uri, null, null)
          throw e
        }
      } else {
        @Suppress("DEPRECATION")
        val downloadsDir =
          Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!downloadsDir.exists()) {
          downloadsDir.mkdirs()
        }
        val destFile = File(downloadsDir, fileName)
        FileInputStream(srcFile).use { input ->
          FileOutputStream(destFile).use { out ->
            input.copyTo(out)
          }
        }
        MediaScannerConnection.scanFile(
          reactContext,
          arrayOf(destFile.absolutePath),
          arrayOf(mimeType),
          null
        )
        promise.resolve(destFile.absolutePath)
      }
    } catch (e: Exception) {
      promise.reject("DOWNLOAD_SAVE_ERROR", e.message, e)
    }
  }
}
