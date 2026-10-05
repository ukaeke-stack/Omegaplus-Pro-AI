package com.omegaplus.ai

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.widget.Toast

class UpdateBridge(private val activity: Activity) {
    private val handler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun startUpdate(apkUrl: String, version: String) {
        activity.runOnUiThread {
            if (!apkUrl.startsWith("https://github.com/ukaeke-stack/Omegaplus-Pro-AI/releases/download/")) {
                Toast.makeText(activity, "Update source is not trusted.", Toast.LENGTH_LONG).show()
                return@runOnUiThread
            }

            if (android.os.Build.VERSION.SDK_INT >= 26 &&
                !activity.packageManager.canRequestPackageInstalls()) {
                Toast.makeText(activity, "Allow Omegaplus AI to install updates, then try again.", Toast.LENGTH_LONG).show()
                val intent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.packageName)
                )
                activity.startActivity(intent)
                return@runOnUiThread
            }

            val request = DownloadManager.Request(Uri.parse(apkUrl))
                .setTitle("Omegaplus AI $version")
                .setDescription("Downloading Omegaplus AI update")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)

            val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val downloadId = manager.enqueue(request)
            Toast.makeText(activity, "Downloading Omegaplus AI $version…", Toast.LENGTH_LONG).show()
            watchDownload(manager, downloadId)
        }
    }

    private fun watchDownload(manager: DownloadManager, id: Long) {
        handler.postDelayed(object : Runnable {
            override fun run() {
                val query = DownloadManager.Query().setFilterById(id)
                manager.query(query)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                        when (status) {
                            DownloadManager.STATUS_SUCCESSFUL -> {
                                val uriString = cursor.getString(
                                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)
                                )
                                if (uriString.isNullOrBlank()) {
                                    Toast.makeText(activity, "Update downloaded but could not be opened.", Toast.LENGTH_LONG).show()
                                } else {
                                    install(Uri.parse(uriString))
                                }
                                return
                            }
                            DownloadManager.STATUS_FAILED -> {
                                Toast.makeText(activity, "Update download failed. Please try again.", Toast.LENGTH_LONG).show()
                                return
                            }
                        }
                    }
                }
                handler.postDelayed(this, 700)
            }
        }, 700)
    }

    private fun install(uri: Uri) {
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            data = uri
            type = "application/vnd.android.package-archive"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra(Intent.EXTRA_RETURN_RESULT, false)
        }
        try {
            activity.startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(activity, "Android could not open the update installer.", Toast.LENGTH_LONG).show()
        }
    }
}
