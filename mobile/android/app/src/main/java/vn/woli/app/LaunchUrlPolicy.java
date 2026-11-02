package vn.woli.app;

import java.util.Locale;

/**
 * Which URLs the launcher may open. Kept free of Android classes so it runs as a plain JVM test.
 */
final class LaunchUrlPolicy {
    private LaunchUrlPolicy() {}

    /** True only for https://{appHost}/... on the default port, without user info. */
    static boolean isAppUrl(String scheme, String host, int port, String userInfo, String appHost) {
        if (appHost == null || appHost.isEmpty() || scheme == null || host == null) return false;
        if (!"https".equals(scheme.toLowerCase(Locale.ROOT))) return false;
        if (port != -1 && port != 443) return false;
        if (userInfo != null) return false;
        return host.toLowerCase(Locale.ROOT).equals(appHost.toLowerCase(Locale.ROOT));
    }
}
