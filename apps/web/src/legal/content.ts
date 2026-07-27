/**
 * Privacy, terms and support as data
 * (docs/adr/0040-legal-and-support-pages-are-routes-in-the-client.md). One module,
 * three routes, one footer, and the desktop ships the same pages because it ships
 * the same build. The wording says plainly what has not been reviewed by a lawyer
 * and what is a placeholder until an operator exists (appendix P9.5).
 */

export type LegalSection = Readonly<{
  heading: string;
  paragraphs: readonly string[];
  /** Rendered as a list under the paragraphs when present. */
  bullets?: readonly string[];
}>;

export type LegalDocument = Readonly<{
  slug: "privacy" | "terms" | "support";
  path: string;
  title: string;
  /** Shown under the title, and used as the link text in the footer. */
  label: string;
  /** The day the wording last changed, in ISO form. */
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}>;

/**
 * There is no operator yet, so the pages name the placeholder rather than inventing
 * a company. ADR-0015 defers the host; this is the same deferral, said out loud on a
 * page a player reads.
 */
export const OPERATOR_PLACEHOLDER = "the maintainer of this repository";

export const SUPPORT_ADDRESS = "support@gobblet.example";

const UPDATED = "2026-07-27";

export const PRIVACY: LegalDocument = Object.freeze({
  slug: "privacy",
  path: "/privacy",
  title: "Privacy",
  label: "Privacy",
  updated: UPDATED,
  intro:
    "What Gobblet Online stores about you, why, and how to be rid of it. This page has not been reviewed by a lawyer, and it describes a service run by " +
    `${OPERATOR_PLACEHOLDER} rather than a company.`,
  sections: [
    {
      heading: "What is stored",
      paragraphs: [
        "An account holds an email address, a username, a hash of your password, and the moment you registered. A guest holds a display name and nothing else.",
        "Playing produces the matches you played, the moves in them, your rating, and the achievements you earned. Those records are what a game is.",
      ],
      bullets: [
        "Account: email address, username, password hash, registration and last sign-in times",
        "Play: matches, moves, clocks, results, rating history, achievements",
        "Operational: request logs and metrics that carry no name and no match identifier",
      ],
    },
    {
      heading: "What is not stored",
      paragraphs: [
        "No cookies are used, so there is no consent banner and no tracking across sites. No advertising identifiers, no third-party analytics in the browser, and no location beyond the country your network implies to any server you contact.",
      ],
    },
    {
      heading: "Where the session lives",
      paragraphs: [
        "Signing in gives the client a token. In a browser it is kept in local storage; in the desktop application it is kept in the operating system credential store. It is strictly necessary: without it you would sign in again on every page.",
      ],
      bullets: [
        "gobblet.session: the session token and the account it belongs to",
        "gobblet.settings: your sound, animation and board preferences",
        "gobblet.telemetry: whether you allowed optional analytics",
      ],
    },
    {
      heading: "Analytics and error reports",
      paragraphs: [
        "Optional analytics and error reporting are off until you turn them on in Settings, and the identifier attached to them is a pseudonym derived from your account, not your address or your name. Turning them off stops the sending immediately.",
      ],
    },
    {
      heading: "How long it is kept",
      paragraphs: [
        "Account and match records are kept while the account exists. Deleting your account removes the account record and anonymises the matches it played, because the other player's history is theirs too and cannot be deleted on your behalf.",
        "Operational logs are kept for thirty days.",
      ],
    },
    {
      heading: "Your choices",
      paragraphs: [
        "You can export your data, turn analytics off, or delete your account from Settings. Writing to the support address below reaches a person who can do the same things by hand.",
      ],
    },
  ],
});

export const TERMS: LegalDocument = Object.freeze({
  slug: "terms",
  path: "/terms",
  title: "Terms of use",
  label: "Terms",
  updated: UPDATED,
  intro:
    "The rules for using Gobblet Online. This page has not been reviewed by a lawyer, and the service is run by " +
    `${OPERATOR_PLACEHOLDER} as a personal project rather than by a company.`,
  sections: [
    {
      heading: "The service",
      paragraphs: [
        "Gobblet Online is a free implementation of the board game Gobblet for two players. It is offered as it is, with no promise that it will be available at any particular moment and no promise that your data survives a mistake, though backups are taken and restoring them is tested.",
      ],
    },
    {
      heading: "Your account",
      paragraphs: [
        "You are responsible for what happens under your account and for keeping your password to yourself. One person, one account: registering several accounts to inflate a rating is a reason for suspension.",
      ],
    },
    {
      heading: "Fair play",
      paragraphs: [
        "Play your own moves. Using a program to choose them, abandoning ranked matches to protect a rating, or abusing an opponent through the preset messages will end in a suspension.",
      ],
      bullets: [
        "No engines, scripts or assistance of any kind in ranked play",
        "No deliberate disconnection to avoid a loss",
        "No harassment, and no attempt to identify another player",
      ],
    },
    {
      heading: "Suspension",
      paragraphs: [
        "An administrator can suspend an account, and every suspension is recorded with a reason. Writing to the support address below reaches a person who will look at it again.",
      ],
    },
    {
      heading: "The game itself",
      paragraphs: [
        "Gobblet is a game designed by Thierry Denoual and published by Blue Orange Games. This implementation is not affiliated with or endorsed by them; the rules are implemented as published, and the implementation is the work of this project.",
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "These terms can change. The date at the top of this page says when they last did, and the history of the change is in the repository.",
      ],
    },
  ],
});

export const SUPPORT: LegalDocument = Object.freeze({
  slug: "support",
  path: "/support",
  title: "Support",
  label: "Support",
  updated: UPDATED,
  intro: "Something wrong, or something missing? Here is what to do about it.",
  sections: [
    {
      heading: "Report a problem",
      paragraphs: [
        `Write to ${SUPPORT_ADDRESS}. Say what you did, what happened, and what you expected instead. If it concerns a match, the address of the match page identifies it exactly.`,
      ],
    },
    {
      heading: "What helps",
      paragraphs: ["The more of this you can say, the faster it is understood."],
      bullets: [
        "The version shown at the bottom of this page",
        "Your browser or the desktop application, and which operating system",
        "The moment it happened, roughly, and whether it happened again",
      ],
    },
    {
      heading: "Account and data",
      paragraphs: [
        "Exporting your data, turning analytics off and deleting your account are all in Settings. If any of them fails, the support address reaches a person who can do it by hand.",
      ],
    },
    {
      heading: "Known problems",
      paragraphs: [
        "Known defects are listed in the repository, in docs/defects.md, with what is being done about each one.",
      ],
    },
  ],
});

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = Object.freeze([PRIVACY, TERMS, SUPPORT]);
