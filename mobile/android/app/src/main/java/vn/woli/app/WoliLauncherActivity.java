package vn.woli.app;

import android.net.Uri;
import android.util.Log;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * The launcher must be exported, so any app on the phone can start it with a URL. The library's
 * LauncherActivity (2.5.0) opens that URL as is; in the WebView fallback a foreign page would then
 * show full screen inside "woli" with no address bar (BUG-35). Only woli's own pages are opened;
 * anything else falls back to the start page.
 */
public class WoliLauncherActivity extends LauncherActivity {
    private static final String TAG = "WoliLauncher";

    @Override
    protected Uri getLaunchingUrl() {
        Uri requested = getIntent() != null ? getIntent().getData() : null;
        if (requested != null) {
            String appHost = getString(R.string.hostName);
            if (LaunchUrlPolicy.isAppUrl(requested.getScheme(), requested.getHost(), requested.getPort(),
                    requested.getUserInfo(), appHost)) {
                return requested;
            }
            Log.w(TAG, "Ignoring a launch URL outside https://" + appHost);
        }
        return Uri.parse(getString(R.string.launchUrl));
    }
}
