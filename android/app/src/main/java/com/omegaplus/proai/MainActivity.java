package com.omegaplus.proai;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageInfo;
import android.view.KeyEvent;
import android.widget.TextView;
import android.widget.Toast;

import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4201;
    private WebView webView;
    private boolean volumeUpPressed;
    private boolean volumeDownPressed;
    private boolean tokenDialogOpen;

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

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) volumeUpPressed = true;
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) volumeDownPressed = true;
        if (volumeUpPressed && volumeDownPressed) {
            showFirebaseToken();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) volumeUpPressed = false;
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) volumeDownPressed = false;
        return super.onKeyUp(keyCode, event);
    }

    private void showFirebaseToken() {
        if (tokenDialogOpen) return;
        tokenDialogOpen = true;
        TextView message = new TextView(this);
        message.setText("Retrieving this installation's Firebase notification token…");
        message.setTextIsSelectable(true);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        message.setPadding(padding, padding, padding, padding);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Notification diagnostics")
                .setView(message)
                .setNegativeButton("Close", (d, which) -> tokenDialogOpen = false)
                .setOnCancelListener(d -> tokenDialogOpen = false)
                .create();
        dialog.show();

        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (isFinishing() || isDestroyed()) {
                tokenDialogOpen = false;
                return;
            }
            if (!task.isSuccessful() || task.getResult() == null || task.getResult().trim().isEmpty()) {
                message.setText("Could not retrieve the Firebase token. Check the internet connection and Firebase configuration, then try again.");
                dialog.setButton(AlertDialog.BUTTON_POSITIVE, "Retry", (d, which) -> {
                    tokenDialogOpen = false;
                    showFirebaseToken();
                });
                dialog.show();
                return;
            }

            String token = task.getResult();
            message.setText("Firebase notification token for this app installation:\n\n" + token
                    + "\n\nCopy this token into Firebase Console → Messaging → Send test message. Treat it as a device identifier and do not post it publicly.");
            dialog.setButton(AlertDialog.BUTTON_POSITIVE, "Copy token", (d, which) -> {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("Firebase messaging token", token));
                    Toast.makeText(MainActivity.this, "Notification token copied", Toast.LENGTH_SHORT).show();
                }
            });
            dialog.show();
        });
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
