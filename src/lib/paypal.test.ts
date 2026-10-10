import assert from "node:assert/strict";
import test from "node:test";
import { getPayPalConfig } from "@/lib/env";
import { getTerminalPayPalCaptureIssue, PayPalApiError } from "@/lib/paypal";

test("enables allowlisted capture mocks only in the PayPal sandbox", () => {
  const previousEnvironment = process.env.PAYPAL_ENVIRONMENT;
  const previousMockCode = process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE;
  try {
    process.env.PAYPAL_ENVIRONMENT = "sandbox";
    process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE = " instrument_declined ";
    assert.equal(getPayPalConfig().captureMockCode, "INSTRUMENT_DECLINED");

    process.env.PAYPAL_ENVIRONMENT = "live";
    assert.equal(getPayPalConfig().captureMockCode, undefined);

    process.env.PAYPAL_ENVIRONMENT = "sandbox";
    process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE = "UNSUPPORTED_CODE";
    assert.equal(getPayPalConfig().captureMockCode, undefined);
  } finally {
    if (previousEnvironment === undefined) delete process.env.PAYPAL_ENVIRONMENT;
    else process.env.PAYPAL_ENVIRONMENT = previousEnvironment;
    if (previousMockCode === undefined) delete process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE;
    else process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE = previousMockCode;
  }
});

test("classifies only permanent capture declines as terminal", () => {
  assert.equal(
    getTerminalPayPalCaptureIssue(
      new PayPalApiError("Declined", 422, "INSTRUMENT_DECLINED"),
    ),
    "INSTRUMENT_DECLINED",
  );
  assert.equal(
    getTerminalPayPalCaptureIssue(
      new PayPalApiError("Refused", 422, "TRANSACTION_REFUSED"),
    ),
    "TRANSACTION_REFUSED",
  );
  assert.equal(
    getTerminalPayPalCaptureIssue(
      new PayPalApiError("Retry later", 500, "INTERNAL_SERVER_ERROR"),
    ),
    null,
  );
});
