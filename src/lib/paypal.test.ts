import assert from "node:assert/strict";
import test from "node:test";
import { getPayPalConfig } from "@/lib/env";
import {
  capturePayPalOrder,
  getTerminalPayPalCaptureIssue,
  PayPalApiError,
} from "@/lib/paypal";

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

test("simulates sandbox capture failures before contacting PayPal", async () => {
  const previousEnvironment = process.env.PAYPAL_ENVIRONMENT;
  const previousMockCode = process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    process.env.PAYPAL_ENVIRONMENT = "sandbox";
    process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE = "INSTRUMENT_DECLINED";
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("PayPal should not be contacted during a local capture simulation.");
    };

    await assert.rejects(
      capturePayPalOrder("paypal-order", "local-order"),
      (error: unknown) =>
        error instanceof PayPalApiError &&
        error.status === 422 &&
        error.issue === "INSTRUMENT_DECLINED",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnvironment === undefined) delete process.env.PAYPAL_ENVIRONMENT;
    else process.env.PAYPAL_ENVIRONMENT = previousEnvironment;
    if (previousMockCode === undefined) delete process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE;
    else process.env.PAYPAL_SANDBOX_CAPTURE_MOCK_CODE = previousMockCode;
  }
});
