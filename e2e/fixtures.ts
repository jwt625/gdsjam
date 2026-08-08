import { test as base, type ConsoleMessage } from "@playwright/test";

export const test = base.extend<{ consoleMessages: string[] }>({
	consoleMessages: async ({ page }, use, testInfo) => {
		const messages: string[] = [];
		const capture = (message: ConsoleMessage) => {
			messages.push(`[${message.type()}] ${message.text()}`);
		};
		page.on("console", capture);
		await use(messages);
		page.off("console", capture);
		if (testInfo.status !== testInfo.expectedStatus || messages.some((line) => line.startsWith("[error]"))) {
			await testInfo.attach("browser-console", {
				body: Buffer.from(`${messages.join("\n")}\n`, "utf8"),
				contentType: "text/plain",
			});
		}
	},
});

export { expect } from "@playwright/test";
