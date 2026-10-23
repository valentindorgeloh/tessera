/** Text helpers and data of the collab part of the demo seed. */
import type { TesseraContext } from "@/lib/tessera/core/context";

type Ctx = TesseraContext;
type Pri = "urgent" | "high" | "medium" | "low" | "none";
export type Report = { by: Ctx; name: string; priority: Pri; labels: string[]; body: string; at: [number, number, number] };

/** Template tag: ´ becomes a backtick and the common indent is dropped. */
export function md(parts: TemplateStringsArray, ...vals: unknown[]): string {
  const raw = parts.reduce((out, p, i) => out + p + (i < vals.length ? String(vals[i]) : ""), "").replaceAll("´", "`");
  const lines = raw.replace(/^\n/, "").replace(/\s+$/, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)?.[0].length ?? 0));
  return lines.map((l) => l.slice(indent)).join("\n");
}

/** A short bug report: summary, numbered steps, expected, actual, environment. */
export const bug = (summary: string, steps: string[], expected: string, actual: string, env: string, extra = ""): string =>
  [summary, "", "**Steps to reproduce**", ...steps.map((s, i) => `${i + 1}. ${s}`), "", `**Expected:** ${expected}`, `**Actual:** ${actual}`, `**Environment:** ${env}`, ...(extra ? ["", extra] : [])].join("\n").replaceAll("´", "`");


/** The intake wave of the MOB project: two on day 2, the rest on day 1. */
export function mobReports(triage: Ctx, release: Ctx): Report[] {
  return [
    { by: triage, name: "Itinerary PDF export cuts off the last day on small screens", priority: "medium", labels: ["Bug"], at: [2, 10, 35], body: bug("Exporting a trip longer than 9 days to PDF drops the last day on phones with a 5.4 inch screen.", ["Open a 12 day trip", "Tap Share, then Export as PDF", "Scroll to the end of the file"], "All 12 days appear.", "The PDF ends after day 11; the footer is cut mid-line.", "iOS 18.4, small iOS phone (5.4 inch), app 4.12.1") },
    { by: triage, name: "Map crashes after rotating an Android 15 phone", priority: "high", labels: ["Bug", "Crash", "Android"], at: [2, 11, 10], body: bug("Three customers wrote in this morning: the app closes when the phone is rotated while the map is open.", ["Open any trip and tap Map", "Rotate the phone twice", "The app closes without a message"], "The map redraws.", "Immediate crash, then the splash screen.", "Android 15 flagship phone, app 4.12.1", "Stack trace ends in ´TileRenderer.draw´ with ´IllegalStateException: Surface has been released´.") },
    { by: release, name: "Crash-free sessions dropped to 98.1% on the 4.13 beta", priority: "high", labels: ["Bug", "Crash", "Performance"], at: [2, 13, 40], body: bug("Beta 2 went out to 5% of testers yesterday and the crash-free rate fell from 99.4% to 98.1%.", ["Open the beta dashboard for 4.13.0 (build 8812)", "Filter by crash group and sort by events"], "Within 0.2 points of 4.12.1.", "One group makes up 71% of the new crashes: ´OutOfMemoryError´ while decoding the hero image on the trip list.", "Android 12 to 15, devices with 3 GB RAM or less") },
    { by: triage, name: "Typo in the cancellation email: \"refundd\"", priority: "low", labels: [], at: [2, 15, 5], body: bug("The subject line of the cancellation confirmation says \"Your refundd is on its way\".", ["Cancel a refundable booking", "Read the email that arrives"], "\"Your refund is on its way\"", "\"Your refundd is on its way\"", "Production email templates, sent from the booking service") },
    { by: triage, name: "Prices show in USD after switching the region to Switzerland", priority: "medium", labels: ["Bug"], at: [1, 8, 50], body: bug("Changing the region in Settings to Switzerland keeps the currency at USD until the app is restarted.", ["Settings, then Region, then Switzerland", "Open the search results"], "Prices in CHF.", "USD until the next cold start; the booking total is correct.", "iOS 18.3 and Android 14, app 4.12.1") },
    { by: triage, name: "Back on the booking confirmation returns to the payment screen", priority: "medium", labels: ["Bug", "Android"], at: [1, 9, 35], body: bug("After paying, the system back gesture goes to the payment screen, which can trigger a second charge attempt.", ["Complete a booking", "On the confirmation screen, swipe back"], "Back goes to the trip overview.", "The payment form opens again with the card field filled.", "Android 14, gesture navigation, app 4.12.1") },
    { by: release, name: "Home screen widget shows yesterday's flight after midnight in UTC+13", priority: "low", labels: ["Bug", "iOS"], at: [1, 10, 20], body: bug("The next-flight widget keeps the previous day's flight for up to 11 hours for travellers in Auckland.", ["Set the device time zone to Auckland", "Add the widget with a flight booked for the next day", "Wait for local midnight"], "The widget shows the next flight at 00:00.", "The old flight stays until about 11:00 local time.", "iOS 18.4, app 4.12.1", "Looks like the widget compares dates in UTC.") },
    { by: triage, name: "The screen reader reads the seat map as \"button button button\"", priority: "high", labels: ["Accessibility", "iOS"], at: [1, 11, 15], body: bug("Seats have no accessible name, so a screen reader user cannot tell which seat is which.", ["Turn on the screen reader", "Open Select seats on any flight", "Swipe through the seat grid"], "\"Seat 14C, available, extra legroom, 24 euro\"", "\"button\", repeated for every seat.", "iOS 18.4, screen reader on, app 4.12.2", "Related to the booking-flow audit in [MOB-8](work:MOB-8).") },
  ];
}
