package com.omegaplus.proai;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageInfo;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4201;
    private WebView webView;

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
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + getPackageName())));
            } catch (Exception e) {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + getPackageName())));
            }
        }
    }

    private static final String APP_URL = "https://omegaplus-pro-ai.vercel.app/";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient());
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);
        webView.addJavascriptInterface(new AppBridge(), "AndroidApp");
        setContentView(webView);
        webView.loadUrl(APP_URL);
        requestNotificationPermissionIfNeeded();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        android.content.SharedPreferences prefs = getSharedPreferences("omegaplus_notifications", MODE_PRIVATE);
        if (prefs.getBoolean("permission_prompted", false)) return;
        prefs.edit().putBoolean("permission_prompted", true).apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
