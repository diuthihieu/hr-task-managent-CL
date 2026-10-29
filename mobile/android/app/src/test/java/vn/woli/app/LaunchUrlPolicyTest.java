package vn.woli.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** BUG-35: another app may start the launcher with any URL; only woli's own pages may open. */
public class LaunchUrlPolicyTest {
    private static final String HOST = "woli.example.vn";

    @Test
    public void acceptsDeepLinksOnTheAppHost() {
        assertTrue(LaunchUrlPolicy.isAppUrl("https", HOST, -1, null, HOST));
        assertTrue(LaunchUrlPolicy.isAppUrl("HTTPS", "WOLI.example.VN", 443, null, HOST));
    }

    @Test
    public void rejectsOtherSites() {
        assertFalse(LaunchUrlPolicy.isAppUrl("https", "example.com", -1, null, HOST));
        assertFalse(LaunchUrlPolicy.isAppUrl("https", "evil-" + HOST, -1, null, HOST));
        assertFalse(LaunchUrlPolicy.isAppUrl("https", HOST + ".evil.com", -1, null, HOST));
        assertFalse(LaunchUrlPolicy.isAppUrl("https", "sub." + HOST, -1, null, HOST));
    }

    @Test
    public void rejectsOtherSchemesPortsAndUserInfo() {
        assertFalse(LaunchUrlPolicy.isAppUrl("http", HOST, -1, null, HOST));
        assertFalse(LaunchUrlPolicy.isAppUrl("javascript", null, -1, null, HOST));
        assertFalse(LaunchUrlPolicy.isAppUrl("https", HOST, 8443, null, HOST));
        assertFalse(LaunchUrlPolicy.isAppUrl("https", HOST, -1, "user:pass", HOST));
        assertFalse(LaunchUrlPolicy.isAppUrl(null, null, -1, null, HOST));
    }

    @Test
    public void rejectsEverythingWhenTheAppHostIsMissing() {
        assertFalse(LaunchUrlPolicy.isAppUrl("https", "", -1, null, ""));
        assertFalse(LaunchUrlPolicy.isAppUrl("https", HOST, -1, null, null));
    }
}
