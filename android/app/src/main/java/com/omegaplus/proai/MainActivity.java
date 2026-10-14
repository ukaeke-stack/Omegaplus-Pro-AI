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
import android.content.SharedPreferences;
import android.provider.Settings;
import android.webkit.WebView;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageInfo;
import android.view.KeyEvent;
import android.widget.TextView;
import android.widget.Toast;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4201;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final long BACK_PRESS_INTERVAL_MS = 2000L;
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private long lastBackPressTime = 0L;
    private boolean notificationPromptVisible;
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
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + getPackageName())));
                } catch (Exception e) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + getPackageName())));
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

        @JavascriptInterface public void syncNotificationToken() {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) return;
                registerTokenWithBackend(task.getResult().trim());
            });
        }
    }

    private static final String APP_URL = "https://omegaplus-pro-ai.vercel.app/";

    /**
     * Registers a token only when this WebView installation has an authenticated session cookie.
     * If no session exists yet, the login/registration flow calls syncNotificationToken again.
     */
    public static void registerTokenWithBackend(String token) {
        if (token == null || token.trim().isEmpty()) return;
        String cleanToken = token.trim();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                String cookies = CookieManager.getInstance().getCookie(APP_URL);
                if (cookies == null || cookies.trim().isEmpty()) return;
                URL url = new URL(APP_URL + "api/notifications/register-device");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Cookie", cookies);
                JSONObject payload = new JSONObject();
                payload.put("token", cleanToken);
                payload.put("platform", "android");
                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
                int responseCode = connection.getResponseCode();
                if (responseCode >= 400) {
                    android.util.Log.w("OmegaplusNotifications", "Device-token registration returned HTTP " + responseCode);
                }
            } catch (Exception e) {
                android.util.Log.w("OmegaplusNotifications", "Device-token registration failed", e);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        createNotificationChannel();
        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                new AppBridge().syncNotificationToken();
                maybeAskForNotificationPermission();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams fileChooserParams) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    Intent pickImage = new Intent(Intent.ACTION_GET_CONTENT);
                    pickImage.addCategory(Intent.CATEGORY_OPENABLE);
                    pickImage.setType("image/*");
                    pickImage.putExtra(Intent.EXTRA_MIME_TYPES,
                            new String[]{"image/png", "image/jpeg", "image/webp"});
                    startActivityForResult(Intent.createChooser(pickImage, "Select fixture screenshot"),
                            FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this,
                            "Unable to open the image picker. Please try again.", Toast.LENGTH_LONG).show();
                    return true;
                }
            }
        });
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);
        webView.addJavascriptInterface(new AppBridge(), "AndroidApp");
        setContentView(webView);
        if (state != null) webView.restoreState(state);
        else webView.loadUrl(APP_URL);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                    "omegaplus_updates", "Omegaplus Pro AI notifications",
                    android.app.NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Optional updates and alerts from Omegaplus Pro AI");
            android.app.NotificationManager manager = getSystemService(android.app.NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void maybeAskForNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            getSharedPreferences("omegaplus_notifications", MODE_PRIVATE)
                    .edit().putBoolean("permission_prompted", true).apply();
            return;
        }
        SharedPreferences prefs = getSharedPreferences("omegaplus_notifications", MODE_PRIVATE);
        if (prefs.getBoolean("permission_explainer_prompted", false) || notificationPromptVisible) return;
        notificationPromptVisible = true;
        new AlertDialog.Builder(this)
                .setTitle("Enable notifications?")
                .setMessage("Allow Omegaplus Pro AI to send notifications? Choose Not now to decide later in your phone's app settings.")
                .setPositiveButton("Enable", (dialog, which) -> {
                    prefs.edit().putBoolean("permission_explainer_prompted", true).apply();
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                })
                .setNegativeButton("Not now", (dialog, which) ->
                        prefs.edit().putBoolean("permission_explainer_prompted", true).apply())
                .setOnCancelListener(dialog -> prefs.edit().putBoolean("permission_explainer_prompted", true).apply())
                .setOnDismissListener(dialog -> notificationPromptVisible = false)
                .show();
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

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE && fileChooserCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            fileChooserCallback.onReceiveValue(results);
            fileChooserCallback = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override protected void onDestroy() {
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

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPressTime < BACK_PRESS_INTERVAL_MS) {
            finish();
        } else {
            lastBackPressTime = now;
            Toast.makeText(this, "Press back again to exit Omegaplus Pro AI", Toast.LENGTH_SHORT).show();
        }
    }
}
