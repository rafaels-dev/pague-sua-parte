import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./endpoint";

describe("isAllowedPushEndpoint", () => {
	it.each([
		"https://fcm.googleapis.com/fcm/send/abc",
		"https://updates.push.services.mozilla.com/wpush/v2/abc",
		"https://wns2-par02p.notify.windows.com/w/?token=abc",
		"https://web.push.apple.com/abc",
		"https://api.push.apple.com/3/device/abc",
		"https://fcm.googleapis.com:443/fcm/send/abc",
	])("aceita %s", (u) => expect(isAllowedPushEndpoint(u)).toBe(true));

	it.each([
		"https://evil-fcm.googleapis.com/x",
		"https://fcm.googleapis.com.evil.com/x",
		"https://evilnotify.windows.com/x",
		"https://notify.windows.com/x",
		"https://evil.com/fcm.googleapis.com",
		"http://fcm.googleapis.com/fcm/send/abc",
		"https://127.0.0.1/x",
		"https://169.254.169.254/latest/meta-data",
		"https://[::1]/x",
		"https://fcm.googleapis.com:8443/x",
		"https://user:pw@fcm.googleapis.com/x",
		"https://user@fcm.googleapis.com/x",
		"https://fcm.googleapis.com@evil.com/x",
		"ftp://fcm.googleapis.com/x",
		"lixo",
		"",
	])("recusa %s", (u) => expect(isAllowedPushEndpoint(u)).toBe(false));
});
