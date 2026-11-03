"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { GroupKind, Platform } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import { groupNames, handleLabels } from "@/lib/handles";
import {
  connectHandle, createWahaSessionAction, disconnectWahaSessionAction, disconnectAccount,
  getWahaStatusAction, getWahaConfigurationAction, reconnectWahaSessionAction, saveWahaConfigurationAction,
  refreshWahaQrAction, requestWahaPairingCodeAction, setWahaAuthMethodAction,
  testWahaConfigurationAction,
  setHandle, type ActionState, type WahaConfigurationView, type WahaViewState,
} from "./actions";
import { SocialContainer, field, type ChannelView } from "./social-container";

export type AccountView = {
  id: string;
  displayName: string;
  connectedText: string;
  profileUrl: string | null;
  matches: boolean;
  // When the access token stops working (e.g. a 60-day Facebook token); null if it doesn't expire
  expiresText: string | null;
};
export type PlatformView = {
  channel: ChannelView;
  handleInput: string;
  handleDisplay: string;
  profileUrl: string | null;
  accounts: AccountView[];
  // Connect from the handle with the business's credentials (.env); setup says what's missing
  byHandle: { ready: boolean; setup: string };
};
export type ConnectView = { href: string; ready: boolean; setupHint: string };

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
      {children}
      <span aria-hidden> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function MetaMark() {
  return (
    <span aria-hidden className="relative flex h-12 w-16 items-center">
      <span className="blend-facebook absolute left-0 size-9 rounded-full ring-2 ring-white/70" />
      <span className="blend-instagram absolute left-3.5 size-9 rounded-full ring-2 ring-white/70" />
      <span className="blend-whatsapp absolute left-7 size-9 rounded-full ring-2 ring-white/70" />
    </span>
  );
}

function WhatsAppConnection({ envReady, admin }: { envReady: boolean; admin: boolean }) {
  const [state, setState] = useState<WahaViewState>({ status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null });
  const [configuration, setConfiguration] = useState<WahaConfigurationView>({ configured: envReady, saved: false, baseUrl: null, apiKeyConfigured: false });
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [countryCode, setCountryCode] = useState("254");
  const localPhone = phoneNumber.replace(/\D/g, "").replace(/^0/, "");
  const fullPhoneNumber = localPhone ? `${countryCode}${localPhone}` : "";
  const [authMethod, setAuthMethod] = useState<"QR" | "PHONE">("QR");
  const [configurationMessage, setConfigurationMessage] = useState<ActionState>();
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [testMessage, setTestMessage] = useState("");
  const [tested, setTested] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [pending, start] = useTransition();
  const pollingInFlight = useRef(false);
  const reconnectPending = useRef(false);
  const pairingPending = useRef(false);
  const qrTimer = useRef<number | null>(null);

  useEffect(() => {
    if (admin) {
      void getWahaConfigurationAction().then((value) => {
        setConfiguration(value);
        setBaseUrl(value.baseUrl ?? "");
      });
    }
    const refresh = () => getWahaStatusAction().then((value) => {
      setState(value);
      if (value.authMethod) setAuthMethod(value.authMethod);
      if (value.phone) {
        const digits = value.phone.replace(/[^\d]/g, "");
        const country = ["971", "966", "255", "256", "250", "260", "263", "234", "233", "254", "27", "44", "91", "1"].find((code) => digits.startsWith(code));
        if (country) {
          setCountryCode(country);
          setPhoneNumber(digits.slice(country.length).replace(/^0/, ""));
        } else {
          setPhoneNumber(digits);
        }
      }
    });
    void refresh();
  }, [admin]);

  useEffect(() => {
    if (["WORKING", "STOPPED", "NOT_CREATED", "LOGGED_OUT"].includes(state.status)) return;
    const pairing = ["STARTING", "SCAN_QR_CODE"].includes(state.status);
    const timer = window.setInterval(() => {
      if (pollingInFlight.current) return;
      pollingInFlight.current = true;
      void getWahaStatusAction().then((value) => {
        setState(value);
        if (value.authMethod) setAuthMethod(value.authMethod);
        if (value.phone) {
          const digits = value.phone.replace(/[^\d]/g, "");
          const country = ["971", "966", "255", "256", "250", "260", "263", "234", "233", "254", "27", "44", "91", "1"].find((code) => digits.startsWith(code));
          if (country) {
            setCountryCode(country);
            setPhoneNumber(digits.slice(country.length).replace(/^0/, ""));
          } else {
            setPhoneNumber(digits);
          }
        }
      }).catch(() => {
        setState((current) => ({ ...current, status: "CONNECTION_ERROR", error: "Could not refresh WAHA connection status." }));
      }).finally(() => {
        pollingInFlight.current = false;
      });
    }, pairing ? 1500 : 5000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  useEffect(() => {
    if (qrTimer.current) window.clearTimeout(qrTimer.current);
    if (state.status !== "SCAN_QR_CODE" || !state.qrExpiresAt) return;
    const remaining = new Date(state.qrExpiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setState((current) => ({ ...current, qr: null, error: "The QR code expired. Waiting for the next QR code." }));
      return;
    }
    qrTimer.current = window.setTimeout(() => {
      setState((current) => ({ ...current, qr: null, error: "The QR code expired. Waiting for the next QR code." }));
    }, remaining);
    return () => {
      if (qrTimer.current) window.clearTimeout(qrTimer.current);
      qrTimer.current = null;
    };
  }, [state.status, state.qr, state.qrExpiresAt]);

  const run = (fn: () => Promise<WahaViewState>, reconnect = false) => {
    if (reconnect && reconnectPending.current) return;
    if (reconnect) reconnectPending.current = true;
    start(async () => {
      try {
        setState(await fn());
      } finally {
        reconnectPending.current = false;
      }
    });
  };
  const connected = state.status === "WORKING";
  const waiting = state.status === "SCAN_QR_CODE" || state.status === "STARTING";
  const progressLabel = connected ? "Connected"
    : state.status === "STARTING" ? "Preparing connection"
      : state.status === "SCAN_QR_CODE" ? (state.qr ? "Waiting for you to scan" : "Generating QR code")
        : state.status === "FAILED" ? "Connection failed"
          : state.status === "LOGGED_OUT" ? "Authentication required"
            : state.status === "DISCONNECTED" ? "Reconnecting…"
              : state.status === "CONNECTION_ERROR" ? "Connection error"
                : state.status.replaceAll("_", " ").toLowerCase();
  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-line bg-white/30 p-3 dark:bg-white/[0.03]">
      {admin && <div className="space-y-3 border-b border-line pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium">WAHA setup</p>
            <p className="text-xs text-ink-soft">
              {configuration.saved ? "Configuration saved" : configuration.configured ? "Configuration available" : "Not configured"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSetupStep((current) => current === 1 ? 1 : current === 2 ? 1 : 2)}
            className="text-xs text-ink-soft underline underline-offset-2"
          >
            Edit setup
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2" aria-label="Setup progress">
          {[1, 2, 3].map((step) => (
            <button
              key={step}
              type="button"
              aria-pressed={setupStep === step}
              onClick={() => setSetupStep(step as 1 | 2 | 3)}
              className={`rounded-lg border px-2 py-1.5 text-[11px] ${setupStep === step ? "border-black bg-black font-medium text-white" : "border-line text-ink-soft"}`}
            >
              {step === 1 ? "Server" : step === 2 ? "Find key" : "Test"}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-line px-3 py-2 text-xs text-ink-soft" aria-label="Setup checklist">
          <p className="mb-1 font-medium text-ink">Setup checklist</p>
          <p>{configuration.saved ? "✓" : "○"} WAHA server configured</p>
          <p>{tested ? "✓" : "○"} WAHA connection tested</p>
          <p>{state.sessionName ? "✓" : "○"} WhatsApp session created</p>
          <p>{state.status === "SCAN_QR_CODE" ? "✓" : "○"} QR authentication started</p>
          <p>{connected ? "✓" : "○"} WhatsApp connected</p>
        </div>

        {setupStep === 1 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">1. Connect the WAHA server</p>
            <p className="text-xs text-ink-soft">WAHA is the service that lets this application connect to WhatsApp.</p>
            <label className="block text-xs text-ink-soft">
              WAHA Server Address
              <input type="url" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTested(false); }} placeholder="https://waha.example.com" className={`${field} mt-1 w-full text-sm`} />
              <span className="mt-1 block">This is the web address of your WAHA service. Do not use localhost on a hosted production site.</span>
            </label>
            <label className="block text-xs text-ink-soft">
              WAHA API Key
              <div className="mt-1 flex gap-2">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setTested(false); }}
                  placeholder={configuration.apiKeyConfigured ? "Saved key •••••••••••• (leave blank to keep)" : "Paste the WAHA API key"}
                  autoComplete="new-password"
                  className={`${field} min-w-0 flex-1 text-sm`}
                />
                <button type="button" onClick={() => setShowApiKey((value) => !value)} className="rounded-full border border-line px-2.5 text-xs text-ink-soft">
                  {showApiKey ? "Hide" : "Reveal"}
                </button>
              </div>
              <span className="mt-1 block">This private key allows the application to communicate with WAHA. It is not your WhatsApp password.</span>
            </label>
            <details className="rounded-xl border border-line px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium">Where do I find the WAHA Server Address and API Key?</summary>
              <div className="mt-2 space-y-2 text-xs text-ink-soft">
                <p className="font-medium text-ink">Local Windows development</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Open File Explorer and go to <span className="font-mono">C:\waha</span>.</li>
                  <li>Open the <span className="font-mono">.env</span> file in Notepad.</li>
                  <li>Find the line beginning with <span className="font-mono">WAHA_API_KEY=</span>.</li>
                  <li>Copy only the value after the equals sign. The dashboard username and password are not the API key.</li>
                </ol>
                <p>If the value begins with <span className="font-mono">sha512:</span>, it is a protected hash, not the original secret. Obtain the original key from whoever created the WAHA installation.</p>
                <p>WAHA dashboard: <ExternalLink href="http://localhost:3001/dashboard">http://localhost:3001/dashboard</ExternalLink></p>
                <p className="font-medium text-ink">Hosted production</p>
                <p>Use the server address supplied by your hosting administrator and obtain the original key from your hosting provider or secure secrets manager. Do not use localhost.</p>
              </div>
            </details>
            <button
              type="button"
              disabled={!baseUrl.trim() || (!apiKey.trim() && !configuration.apiKeyConfigured)}
              onClick={() => {
                try {
                  const url = new URL(baseUrl.trim());
                  if (!["http:", "https:"].includes(url.protocol)) throw new Error();
                } catch {
                  setConfigurationMessage({ error: "Enter a valid HTTP or HTTPS WAHA server address." });
                  return;
                }
                setConfigurationMessage(undefined);
                setSetupStep(2);
              }}
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink"
            >
              Continue
            </button>
          </div>
        )}

        {setupStep === 2 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">2. Guided credential instructions</p>
            <ol className="list-decimal space-y-1 rounded-xl border border-line p-3 pl-8 text-xs text-ink-soft">
              <li>Open the WAHA installation folder or hosting secrets manager.</li>
              <li>Find the WAHA API key configured for this server.</li>
              <li>Copy only the original secret, not a <span className="font-mono">sha512:</span> hash.</li>
              <li>Paste it into the WAHA API Key field and keep it private.</li>
            </ol>
            <div className="text-xs text-ink-soft">
              <p><span className="font-medium text-ink">WAHA Server Address:</span> where this application sends WhatsApp connection requests.</p>
              <p><span className="font-medium text-ink">WAHA API Key:</span> the private secret for that service.</p>
              <p><span className="font-medium text-ink">Webhook Address:</span> created and managed automatically by the application.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setSetupStep(1)} className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium">Back</button>
              <button type="button" onClick={() => {
                if (baseUrl) void navigator.clipboard.writeText(baseUrl).then(() => {
                  setCopyMessage("WAHA server address copied.");
                  window.setTimeout(() => setCopyMessage(""), 2500);
                }).catch(() => setCopyMessage("Copy failed. Select and copy the address manually."));
              }} className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium">Copy server address</button>
              <button type="button" onClick={() => setSetupStep(3)} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-ink">Continue to connection test</button>
            </div>
            {copyMessage && <p role="status" className="text-xs text-ink-soft">{copyMessage}</p>}
          </div>
        )}

        {setupStep === 3 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">3. Test the connection</p>
            <p className="text-xs text-ink-soft">The application will securely check the WAHA server and access key.</p>
            <button
              type="button"
              disabled={pending || !baseUrl.trim() || (!apiKey.trim() && !configuration.apiKeyConfigured)}
              onClick={() => start(async () => {
                setTestMessage("");
                const result = await testWahaConfigurationAction({ baseUrl, apiKey: apiKey || undefined });
                setTested(Boolean(result.ok));
                setTestMessage(result.message);
              })}
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink"
            >
              {pending ? "Testing…" : configuration.saved ? "Test and update configuration" : "Test WAHA Connection"}
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setSetupStep(2)} className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium">Back</button>
              {tested && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(async () => {
                    const saved = await saveWahaConfigurationAction({ baseUrl, apiKey: apiKey || undefined });
                    setConfiguration(saved);
                    setConfigurationMessage(saved);
                    if (saved.saved) {
                      setApiKey("");
                      setTested(true);
                      setTestMessage(saved.message ?? "WAHA configuration saved.");
                    }
                  })}
                  className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink"
                >
                  {pending ? "Saving…" : "Save configuration"}
                </button>
              )}
              {configuration.saved && (
                <button
                  type="button"
                  onClick={() => document.getElementById("whatsapp-connect")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium"
                >
                  Continue to WhatsApp
                </button>
              )}
            </div>
            {(testMessage || configurationMessage?.error) && (
              <p role="status" className={`text-xs ${tested ? "text-emerald-700 dark:text-emerald-300" : "text-danger"}`}>
                {testMessage || configurationMessage?.error}
              </p>
            )}
          </div>
        )}

        <details className="rounded-xl border border-line px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">Having trouble connecting?</summary>
          <div className="mt-2 space-y-1 text-xs text-ink-soft">
            <p><span className="font-medium text-ink">The QR code is not appearing:</span> WAHA may still be starting. The page checks automatically.</p>
            <p><span className="font-medium text-ink">The QR code expired:</span> a new code will be generated automatically.</p>
            <p><span className="font-medium text-ink">Connection failed:</span> wait for recovery, then reconnect if asked.</p>
            <p><span className="font-medium text-ink">The server cannot be reached:</span> check that WAHA is running and verify the server address.</p>
            <p><span className="font-medium text-ink">Invalid API key:</span> paste the original secret that matches the WAHA server.</p>
          </div>
        </details>
      </div>}
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">WhatsApp connection</p>
          <p className="text-xs text-ink-soft">{progressLabel}</p>
        </div>
        <span className={`size-2.5 rounded-full ${connected ? "bg-emerald-500" : waiting ? "bg-amber-500" : "bg-slate-400"}`} aria-label={state.status} />
      </div>
      {!configuration.saved && !envReady && <p role="alert" className="text-xs text-danger">Save WAHA configuration before creating a session.</p>}
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {!connected && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="WhatsApp authentication method">
          <button type="button" aria-pressed={authMethod === "QR"} onClick={() => { setAuthMethod("QR"); setCopyMessage(""); start(async () => setState(await setWahaAuthMethodAction("QR"))); }} disabled={pending} className={`rounded-lg border px-3 py-2 text-xs font-medium ${authMethod === "QR" ? "border-black bg-black text-white" : "border-line text-ink-soft"}`}>Scan QR Code</button>
          <button type="button" aria-pressed={authMethod === "PHONE"} onClick={() => { setAuthMethod("PHONE"); setCopyMessage(""); start(async () => setState(await setWahaAuthMethodAction("PHONE"))); }} disabled={pending} className={`rounded-lg border px-3 py-2 text-xs font-medium ${authMethod === "PHONE" ? "border-black bg-black text-white" : "border-line text-ink-soft"}`}>Connect Using Phone Number</button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[145px_minmax(0,1fr)]">
        <label className="block text-xs text-ink-soft">
          Country
          <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} disabled={connected || pending} className={`${field} mt-1 w-full min-w-0 px-3 py-2.5 text-sm`}>
            <option value="254">Kenya +254</option>
            <option value="255">Tanzania +255</option>
            <option value="256">Uganda +256</option>
            <option value="250">Rwanda +250</option>
            <option value="260">Zambia +260</option>
            <option value="263">Zimbabwe +263</option>
            <option value="27">South Africa +27</option>
            <option value="234">Nigeria +234</option>
            <option value="233">Ghana +233</option>
            <option value="1">USA/Canada +1</option>
            <option value="44">UK +44</option>
            <option value="91">India +91</option>
            <option value="971">UAE +971</option>
            <option value="966">Saudi Arabia +966</option>
          </select>
        </label>
        <label className="block text-xs text-ink-soft">
          WhatsApp phone number
          <input
            id="whatsapp-connect"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder={authMethod === "PHONE" ? "712345678" : "712345678"}
            disabled={connected || pending}
            className={`${field} mt-1 w-full min-w-0 px-3 py-2.5 text-sm`}
          />
        </label>
      </div>
      {state.sessionName && (
        <div className="text-xs text-ink-soft">
          <p>Session name: <span className="font-mono">{state.sessionName}</span></p>
        </div>
      )}
      {connected && (
        <div className="text-xs text-ink-soft">
          {state.account && <p>Account: {state.account}</p>}
          {state.phone && <p>Phone: {state.phone}</p>}
        </div>
      )}
      {state.pairingMismatch && (
        <p role="alert" className="text-xs text-danger">The paired WhatsApp account does not match the entered phone number.</p>
      )}
      {authMethod === "PHONE" && state.pairingCode && (
        <div className="space-y-3 rounded-xl border border-line bg-white/50 p-3 dark:bg-white/[0.04]">
          <div>
            <p className="text-xs font-medium">Your device-linking code</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-ink">{state.pairingCode}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.pairingCode ?? "")
                .then(() => setCopyMessage("Pairing code copied."))
                .catch(() => setCopyMessage("Could not copy automatically. Select the code and copy it manually."));
            }}
            className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium"
          >
            Copy Code
          </button>
          {copyMessage && <p className="text-xs text-emerald-700 dark:text-emerald-300">{copyMessage}</p>}
          <div className="text-xs text-ink-soft">
            <p className="font-medium text-ink">Enter the code in WhatsApp:</p>
            <ol className="mt-1 list-decimal space-y-1 pl-4">
              <li>Open WhatsApp on the phone.</li>
              <li>Go to Settings → Linked Devices.</li>
              <li>Tap Link a Device, then Link with Phone Number Instead.</li>
              <li>Enter this pairing code to link this WhatsApp account.</li>
            </ol>
            <p>This is a device-linking code, not an SMS OTP.</p>
          </div>
        </div>
      )}
      {authMethod === "PHONE" && !connected && !state.pairingCode && (
        <button
          type="button"
          disabled={pending || pairingPending.current || (!configuration.saved && !envReady) || !/^\d{8,15}$/.test(fullPhoneNumber)}
          onClick={() => {
            if (pairingPending.current) return;
            pairingPending.current = true;
            start(async () => {
              try {
                setState(await requestWahaPairingCodeAction(fullPhoneNumber));
              } finally {
                pairingPending.current = false;
              }
            });
          }}
          className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink"
        >
          {pending ? "Generating pairing code…" : "Connect Using Phone Number"}
        </button>
      )}
      {authMethod === "QR" && state.qr && (
        <div className="space-y-2 rounded-xl bg-white p-3">
          <div className="flex justify-center">
            {/* WAHA returns the QR image only from the server; the browser never receives the WAHA API key. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.qr} alt="Scan this QR code with WhatsApp Linked Devices" className="size-56 rounded-lg" />
          </div>
          <div className="text-xs text-ink-soft">
            <p className="font-medium text-ink">Open WhatsApp on your phone:</p>
            <p>Android: tap the three dots, then Linked devices.</p>
            <p>iPhone: open Settings, then Linked Devices.</p>
            <p>Tap Link a device, then scan this QR code.</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {authMethod === "QR" && state.status === "SCAN_QR_CODE" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(refreshWahaQrAction)}
            className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            Refresh QR code
          </button>
        )}
        {!connected && authMethod === "QR" && (
          <button
            type="button"
            disabled={pending || (!configuration.saved && !envReady)}
            onClick={() => run(state.status === "NOT_CREATED"
              ? () => createWahaSessionAction()
              : () => reconnectWahaSessionAction(), true)}
            className="blend-whatsapp rounded-full px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {pending ? "Connecting…" : state.status === "NOT_CREATED" ? "Connect WhatsApp" : "Reconnect"}
          </button>
        )}
        {connected && (
          <button type="button" disabled={pending} onClick={() => run(disconnectWahaSessionAction)} className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium hover:bg-white/60 disabled:opacity-60">
            {pending ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>
      {waiting && <p className="text-xs text-ink-soft">{authMethod === "PHONE"
        ? "In WhatsApp: Linked Devices → Link a Device → Link with Phone Number Instead."
        : "In WhatsApp: Settings → Linked Devices → Link a device."}</p>}
    </div>
  );
}

// One platform in Settings: the number/handle/link it posts to (editable here) and what's connected.
function HandleRow({ item, admin, extra }: { item: PlatformView; admin: boolean; extra?: React.ReactNode }) {
  const p = item.channel.platform;
  const [editing, setEditing] = useState(!item.handleInput);
  const [value, setValue] = useState(item.handleInput);
  const [state, setState] = useState<ActionState>();
  const [pending, start] = useTransition();
  const label = handleLabels[p];
  const connected = item.accounts.some((a) => a.matches);
  return (
    <li>
      <div className="flex items-center gap-2">
        <PlatformBadge platform={p} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{platforms[p].name}</p>
          {!editing && (
            <p className="truncate text-xs text-ink-soft">
              {item.profileUrl ? <ExternalLink href={item.profileUrl}>{item.handleDisplay}</ExternalLink> : item.handleDisplay}
            </p>
          )}
        </div>
        {admin && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="rounded-full px-2.5 py-1 text-xs text-ink-soft hover:text-ink">
            Change
          </button>
        )}
      </div>
      {admin && editing && (
        <form
          className="mt-2 flex flex-wrap gap-2 pl-9"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await setHandle(item.channel.id, value);
              setState(res);
              if (res?.ok) setEditing(false);
            });
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={label.placeholder}
            aria-label={`${label.label}: number, handle or link`}
            className={`${field} min-w-0 flex-1 text-sm`}
          />
          <button type="submit" disabled={pending} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-ink">
            {pending ? (item.byHandle.ready ? "Saving and connecting…" : "Saving…") : item.byHandle.ready ? "Save & connect" : "Save"}
          </button>
          {item.handleInput && (
            <button type="button" onClick={() => setEditing(false)} className="px-2 text-xs text-ink-soft hover:text-ink">
              Cancel
            </button>
          )}
          <p className="w-full text-xs text-ink-soft">{label.hint}. Paste a link or type it; either works.</p>
        </form>
      )}
      {admin && !editing && item.handleInput && !connected && (
        <div className="mt-2 pl-9">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setState(await connectHandle(item.channel.id)))}
            className={`${platforms[p].blend} rounded-full px-3.5 py-1.5 text-xs font-medium text-white shadow-sm`}
          >
            {pending ? "Connecting…" : `Connect ${item.handleDisplay}`}
          </button>
          {!item.byHandle.ready && <p className="mt-1 text-xs text-ink-soft">To connect from the handle, {item.byHandle.setup}.</p>}
        </div>
      )}
      {state?.error && <p role="alert" className="mt-1 pl-9 text-xs text-danger">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="mt-1 pl-9 text-xs font-medium text-emerald-700 dark:text-emerald-300">{state.message}</p>}
      {state?.ok && state.note && <p className="mt-1 pl-9 text-xs text-amber-800 dark:text-amber-200">{state.note}</p>}
      <AccountList accounts={item.accounts} admin={admin} />
      {extra && <div className="pl-9">{extra}</div>}
    </li>
  );
}

function AccountList({ accounts, admin }: { accounts: AccountView[]; admin: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ id: string; state: ActionState }>();
  if (accounts.length === 0) return <p className="mt-2 pl-9 text-xs text-ink-soft">Not connected yet.</p>;
  return (
    <ul className="mt-2 space-y-1.5 pl-9">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center gap-2">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${a.matches ? "bg-wa" : "bg-amber-500"}`} />
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-medium">{a.profileUrl ? <ExternalLink href={a.profileUrl}>{a.displayName}</ExternalLink> : a.displayName}</p>
            <p className="text-ink-soft">
              {a.matches ? `Connected · ${a.connectedText}` : "Doesn't match the handle, so nothing is posted here"}
              {a.matches && a.expiresText ? ` · reconnect before ${a.expiresText}` : ""}
            </p>
          </div>
          {admin && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Disconnect ${a.displayName}? It will stop posting to this account.`)) return;
                start(async () => setResult({ id: a.id, state: await disconnectAccount(a.id) }));
              }}
              className="rounded-full px-2.5 py-1 text-xs text-ink-soft hover:bg-danger/10 hover:text-danger"
            >
              Disconnect
            </button>
          )}
          {result?.id === a.id && result.state?.error && <span role="alert" className="text-xs text-danger">{result.state.error}</span>}
          {result?.id === a.id && result.state?.ok && <span role="status" className="text-xs text-emerald-700 dark:text-emerald-300">Disconnected ✓</span>}
        </li>
      ))}
    </ul>
  );
}

// Settings: the numbers/handles each platform posts to, and connecting the real accounts behind them.
function Settings({
  kind,
  items,
  connect,
  whatsappEnvReady,
  admin,
}: {
  kind: GroupKind;
  items: PlatformView[];
  connect: ConnectView | null;
  whatsappEnvReady: boolean;
  admin: boolean;
}) {
  const needsConnect = items.some((i) => !i.accounts.some((a) => a.matches));
  const names = items.map((i) => platforms[i.channel.platform].name);
  const connectLabel =
    kind === "META" ? `Connect ${names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0]}` : `Connect ${items[0]?.handleDisplay}`;
  const wa = items.find((i) => i.channel.platform === "WHATSAPP");

  return (
    <section aria-label={`${groupNames[kind]} settings`} className="self-start rounded-3xl border border-line bg-white/25 p-5 dark:bg-white/[0.03]">
      <h3 className="font-semibold">Settings</h3>
      <p className="mt-0.5 text-sm text-ink-soft">Type the number, handle or link of each account. It connects from the handle; no copying IDs or tokens.</p>

      <ul className="mt-4 space-y-4">
        {items.map((i) => (
          <HandleRow
            key={i.channel.platform}
            item={i}
            admin={admin}
            extra={
              i === wa ? <WhatsAppConnection envReady={whatsappEnvReady} admin={admin} /> : undefined
            }
          />
        ))}
      </ul>

      {admin && connect && items.length > 0 && (connect.ready || !items.every((i) => i.byHandle.ready)) && (
        <div className="mt-5 border-t border-line pt-4">
          {connect.ready ? (
            <>
              <a
                href={connect.href}
                aria-disabled={items.some((i) => !i.handleInput)}
                className={`${kind === "META" ? "blend-facebook" : platforms[items[0].channel.platform].blend} inline-block rounded-full px-4 py-2 text-sm font-medium text-white shadow-md ${items.some((i) => !i.handleInput) ? "pointer-events-none opacity-50" : ""}`}
              >
                {needsConnect ? `Or sign in: ${connectLabel}` : "Reconnect by signing in"}
              </a>
              <p className="mt-2 text-xs text-ink-soft">
                {kind === "META"
                  ? `You'll sign in with Facebook once and approve access. The backend then finds the ${names.join(", ")} you entered above and sets up the connection${wa ? ", including WhatsApp's phone number ID and access token" : ""}.`
                  : "You'll sign in on the platform and approve access. Only the account matching the handle above is linked."}
              </p>
            </>
          ) : items.every((i) => i.byHandle.ready) ? null : (
            // Only matters when the handles can't connect on their own
            <p className="rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-ink-soft">Optional sign-in instead of handles: {connect.setupHint.replace(/^Not set up yet: /, "")}</p>
          )}
        </div>
      )}
    </section>
  );
}

// Parent container: settings for the group's accounts, plus one social container per platform.
export function GroupCard({
  group,
  items,
  connect,
  whatsappEnvReady,
  admin,
}: {
  group: { id: string; kind: GroupKind };
  items: PlatformView[];
  connect: ConnectView | null;
  whatsappEnvReady: boolean;
  admin: boolean;
}) {
  const name = groupNames[group.kind];
  const active = items.filter((i) => i.channel.enabled).length;
  const summary =
    items.length === 0
      ? "No platforms"
      : `${items.map((i) => platforms[i.channel.platform].name).join(", ")} · ${active ? `${active} scheduled` : "no schedules on"}`;
  const glow = group.kind === "META" ? "blend-meta" : platforms[items[0]?.channel.platform ?? (group.kind as Platform)].blend;

  return (
    <article className="glass relative overflow-hidden rounded-[32px] p-5 sm:p-6" aria-label={`${name} container`}>
      <div aria-hidden className={`${glow} pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-30 blur-3xl`} />
      <header className="relative flex flex-wrap items-center gap-3">
        {group.kind === "META" ? <MetaMark /> : <PlatformBadge platform={group.kind as Platform} size="lg" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{name}</h2>
          <p className="text-sm text-ink-soft">{summary}</p>
        </div>
      </header>


      <div className="relative mt-5 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <Settings kind={group.kind} items={items} connect={connect} whatsappEnvReady={whatsappEnvReady} admin={admin} />
        <div className="space-y-4">
          {items.map((i) => (
            <SocialContainer key={i.channel.id} channel={i.channel} admin={admin} />
          ))}
        </div>
      </div>
    </article>
  );
}
