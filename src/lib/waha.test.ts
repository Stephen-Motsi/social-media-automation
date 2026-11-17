import {
  canStartReconnect,
  normalizeWahaPhoneNumber,
  shouldFetchWahaQr,
  shouldRestartFailedSession,
  wahaHttpTimeoutMs,
  wahaQrExpiryMs,
  canRequestWahaPairingCode,
  formatWahaPairingCode,
  wahaPairingTimeoutMs,
  wahaPairingCodeExpiry,
  WahaApiError,
} from "./waha";

function expect(condition: boolean, message = "Expected condition to be true") {
  if (!condition) throw new Error(message);
}

expect(normalizeWahaPhoneNumber("+254 712 345 678") === "254712345678");

let rejected = false;
try {
  normalizeWahaPhoneNumber("123");
} catch {
  rejected = true;
}
expect(rejected, "Short phone numbers must be rejected");

expect(wahaQrExpiryMs(1) === 300_000, "A QR scan window should last 5 minutes");
expect(wahaQrExpiryMs(2) === 300_000, "Later QR codes keep the same 5-minute window");
expect(!shouldFetchWahaQr("FAILED"), "QR must not be fetched from a failed session");
expect(!shouldFetchWahaQr("STARTING"), "QR must not be fetched while starting");
expect(!shouldFetchWahaQr("STOPPED"), "QR must not be fetched while stopped");
expect(!shouldFetchWahaQr("WORKING"), "QR must not be fetched while working");
expect(shouldFetchWahaQr("SCAN_QR_CODE", 0), "QR can be fetched during SCAN_QR_CODE");
expect(!shouldFetchWahaQr("SCAN_QR_CODE", 6), "Six QR codes should require restart");
expect(shouldRestartFailedSession("FAILED", 0), "A failed session should restart once");
expect(!shouldRestartFailedSession("FAILED", 1), "A failed session should not restart repeatedly");
expect(wahaHttpTimeoutMs("2500") === 2500, "WAHA timeout should be configurable");
expect(wahaHttpTimeoutMs("invalid") === 15_000, "Invalid WAHA timeout should use the default");
expect(wahaPairingTimeoutMs("8000") === 8000, "Pairing timeout should be configurable independently");
expect(wahaPairingTimeoutMs("invalid") === 10_000, "Invalid pairing timeout should use the fast default");
expect(!canStartReconnect(true, "FAILED"), "Duplicate reconnect should be blocked");
expect(!canStartReconnect(false, "SCAN_QR_CODE"), "Reconnect should not start during pairing");
expect(canStartReconnect(false, "FAILED"), "Reconnect should be allowed while failed");
expect(new WahaApiError(422, "state").status === 422, "HTTP 422 should remain distinguishable");
expect(formatWahaPairingCode("abcdabcd") === "ABCD-ABCD", "Pairing code should be normalized");
expect(formatWahaPairingCode("123") === null, "Invalid pairing codes should be rejected");
expect(canRequestWahaPairingCode("SCAN_QR_CODE"), "Pairing code can be requested during QR pairing state");
expect(!canRequestWahaPairingCode("STARTING"), "Pairing code must wait until the session is ready");
expect(!canRequestWahaPairingCode("FAILED"), "Pairing code must not be requested from failed sessions");
expect(!canRequestWahaPairingCode("SCAN_QR_CODE", true), "Duplicate pairing requests should be blocked");
expect(!canRequestWahaPairingCode("SCAN_QR_CODE", false, new Date(Date.now() + 60_000)), "An active pairing code should not be replaced");
expect(canRequestWahaPairingCode("SCAN_QR_CODE", false, new Date(Date.now() - 1)), "An expired pairing code should be replaceable");
expect(canRequestWahaPairingCode("SCAN_QR_CODE", false, null), "A pairing code without an expiry should be replaceable");
const requestedAt = new Date(Date.now() - 61_000);
expect(canRequestWahaPairingCode("SCAN_QR_CODE", false, wahaPairingCodeExpiry(requestedAt, new Date(Date.now() + 86_400_000))), "Legacy 24-hour pairing codes should expire after one minute");
expect(wahaPairingCodeExpiry(null, new Date()) === null, "A pairing code without a request time should be replaceable");

console.log("PASS waha phone validation");
