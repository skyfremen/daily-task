export const VOUCHER_URL =
  "https://in.luckincoffee.com/activity/getCoupon?sendCouponWebConfigNo=LKSG118175131058651136&tenant=LKSG&marketingCode=LKSGMK118175121864736768";

const SUCCESS_MARKER = "$3.99 exchange";
const HUMAN_VERIFICATION_MARKERS = [
  "captcha",
  "human verification",
  "verify you are human",
  "one-time password",
  "one time password",
  "otp",
  "robot check",
  "unusual traffic",
  "security verification"
];

export class ClaimError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClaimError";
  }
}

export function readConfig(env = process.env) {
  const phone = String(env.LUCKIN_PHONE ?? "").trim();
  if (!phone) {
    throw new ClaimError("LUCKIN_PHONE secret is missing");
  }

  return {
    phone,
    voucherUrl: VOUCHER_URL,
    dryRun: process.argv.includes("--dry-run") || env.DRY_RUN === "1"
  };
}

export function classifyPageText(text) {
  const normalized = String(text ?? "").toLowerCase();

  if (normalized.includes(SUCCESS_MARKER)) {
    return "success";
  }

  if (HUMAN_VERIFICATION_MARKERS.some((marker) => normalized.includes(marker))) {
    return "human_verification";
  }

  if (
    normalized.includes("mobile number") ||
    normalized.includes("enter your phone number") ||
    normalized.includes("get $3.99")
  ) {
    return "form";
  }

  return "unknown";
}

async function runClaim({ phone, voucherUrl }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(voucherUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const initialState = classifyPageText(await page.locator("body").innerText());
    if (initialState === "human_verification") {
      throw new ClaimError("Luckin requires human verification");
    }

    const phoneInput = page.getByPlaceholder("Mobile Number");
    if ((await phoneInput.count()) !== 1) {
      throw new ClaimError("Luckin phone-number field was not found");
    }

    await phoneInput.fill(phone);

    let submitButton = page.getByRole("button", {
      name: "Get $3.99 Exchange Voucher"
    });
    if ((await submitButton.count()) === 0) {
      submitButton = page.getByText("Get $3.99 Exchange Voucher", {
        exact: true
      });
    }
    if ((await submitButton.count()) !== 1) {
      throw new ClaimError("Luckin voucher button was not found");
    }

    await submitButton.click();
    await page.waitForTimeout(2500);

    const result = classifyPageText(await page.locator("body").innerText());
    if (result === "success") {
      return { status: "success" };
    }

    if (result === "human_verification") {
      throw new ClaimError("Luckin requires human verification");
    }

    throw new ClaimError("Luckin did not show a successful voucher result");
  } finally {
    await browser.close();
  }
}

async function main() {
  const config = readConfig();

  if (config.dryRun) {
    console.log("dry-run configuration valid");
    return;
  }

  console.log("opening voucher page");
  const result = await runClaim(config);
  if (result.status === "success") {
    console.log("voucher success detected");
  }
}

main().catch((error) => {
  const message =
    error instanceof ClaimError
      ? error.message
      : "voucher claim failed during browser execution";
  console.error(message);
  process.exitCode = 1;
});
