package com.omegaplus.proai;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.os.Handler;
import android.os.Looper;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1002;
    private static final String PREFS_NAME = "omegaplus_native_prefs";
    private static final String PREF_NOTIFICATION_PROMPTED = "notification_prompted";
    private static final String APP_URL = "https://omegaplus-pro-ai.vercel.app/";
    private static final long BACK_PRESS_INTERVAL_MS = 2000L;

    private ValueCallback<Uri[]> fileChooserCallback;
    private WebView webView;
    private long lastBackPressTime = 0L;

    public class AppBridge {
        @JavascriptInterface public String getVersionName() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return info.versionName != null ? info.versionName : "";
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface public int getVersionCode() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return (int) info.getLongVersionCode();
                }
                return info.versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface public void openPlayStore() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("market://details?id=" + getPackageName())));
                } catch (Exception e) {
                    startActivity(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://play.google.com/store/apps/details?id=" + getPackageName())));
                }
            });
        }

        @JavascriptInterface public void openAppNotificationSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            });
        }
    }

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        createNotificationChannel();

        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                maybeAskForNotificationPermission();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams fileChooserParams) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;

                try {
                    Intent pickImage = new Intent(Intent.ACTION_GET_CONTENT);
                    pickImage.addCategory(Intent.CATEGORY_OPENABLE);
                    pickImage.setType("image/*");
                    pickImage.putExtra(Intent.EXTRA_MIME_TYPES,
                            new String[]{"image/png", "image/jpeg", "image/webp"});
                    startActivityForResult(
                            Intent.createChooser(pickImage, "Select fixture screenshot"),
                            FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this,
                            "Unable to open the image picker. Please try again.",
                            Toast.LENGTH_LONG).show();
                    return true;
                }
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setSupportZoom(false);
        webView.addJavascriptInterface(new AppBridge(), "AndroidApp");
        setContentView(webView);

        if (state != null) {
            webView.restoreState(state);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                    "omegaplus_updates",
                    "Omegaplus Pro AI notifications",
                    android.app.NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Optional updates and alerts from Omegaplus Pro AI");
            android.app.NotificationManager manager =
                    getSystemService(android.app.NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void maybeAskForNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean(PREF_NOTIFICATION_PROMPTED, false)) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putBoolean(PREF_NOTIFICATION_PROMPTED, true).apply();
            return;
        }

        new AlertDialog.Builder(this)
                .setTitle("Enable notifications?")
                .setMessage("Allow Omegaplus Pro AI to send notifications? You can choose Not now and change this later in your phone's app settings.")
                .setPositiveButton("Enable", (dialog, which) -> {
                    prefs.edit().putBoolean(PREF_NOTIFICATION_PROMPTED, true).apply();
                    requestPermissions(
                            new String[]{Manifest.permission.POST_NOTIFICATIONS},
                            NOTIFICATION_PERMISSION_REQUEST_CODE);
                })
                .setNegativeButton("Not now", (dialog, which) ->
                        prefs.edit().putBoolean(PREF_NOTIFICATION_PROMPTED, true).apply())
                .setOnCancelListener(dialog ->
                        prefs.edit().putBoolean(PREF_NOTIFICATION_PROMPTED, true).apply())
                .show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (fileChooserCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    Uri selectedUri = data.getData();
                    if (selectedUri != null) {
                        results = new Uri[]{selectedUri};
                    }
                }
                fileChooserCallback.onReceiveValue(results);
                fileChooserCallback = null;
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        long now = System.currentTimeMillis();
        if (now - lastBackPressTime < BACK_PRESS_INTERVAL_MS) {
            finish();
        } else {
            lastBackPressTime = now;
            Toast.makeText(this, "Press back again to exit Omegaplus Pro AI",
                    Toast.LENGTH_SHORT).show();
        }
    }
}
