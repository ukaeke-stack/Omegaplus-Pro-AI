package com.omegaplus.proai;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://omegaplus-pro-ai-production.up.railway.app/";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView web = new WebView(this);
        web.setWebViewClient(new WebViewClient());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);
        web.loadUrl(APP_URL);
        setContentView(web);
    }
    @Override public void onBackPressed() {
        WebView web = (WebView) findViewById(android.R.id.content);
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
