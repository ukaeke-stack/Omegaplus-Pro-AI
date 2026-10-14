package com.omegaplus.proai;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class OmegaplusFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "omegaplus_updates";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        String title = "Omegaplus Pro AI";
        String body = "You have a new update.";

        if (message.getNotification() != null) {
            if (message.getNotification().getTitle() != null && !message.getNotification().getTitle().trim().isEmpty()) {
                title = message.getNotification().getTitle();
            }
            if (message.getNotification().getBody() != null && !message.getNotification().getBody().trim().isEmpty()) {
                body = message.getNotification().getBody();
            }
        } else {
            if (message.getData().get("title") != null) title = message.getData().get("title");
            if (message.getData().get("body") != null) body = message.getData().get("body");
        }

        showNotification(title, body);
    }

    @Override
    public void onNewToken(String token) {
        // If a signed-in WebView session is available, register the refreshed token immediately.
        // Otherwise, MainActivity syncs the current token after the app opens or the user signs in.
        MainActivity.registerTokenWithBackend(token);
    }

    private void showNotification(String title, String body) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Omegaplus updates", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Sports prediction and app update notifications");
            manager.createNotificationChannel(channel);
        }

        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = null;
        if (launchIntent != null) {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, flags);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true);

        if (pendingIntent != null) builder.setContentIntent(pendingIntent);
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
    }
}
