package app.wodsiege.pilot;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // USB adb reverse serves the pilot API over HTTP on localhost.
        // The debug network security config limits HTTP to loopback hosts.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            getBridge().getWebView().getSettings()
                .setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
}
