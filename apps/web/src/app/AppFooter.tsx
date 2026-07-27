import { cx } from "@gobblet/design-system";
import { NavLink } from "react-router";
import { clientConfig } from "../config";
import { isDesktop } from "../desktop/host";
import { LEGAL_DOCUMENTS } from "../legal/content";
import styles from "./AppFooter.module.css";

/**
 * On every screen, because a privacy policy nobody can find is not published
 * (docs/adr/0040-legal-and-support-pages-are-routes-in-the-client.md). The version is
 * here too: it is the first thing a support message needs and the last thing anyone
 * remembers to ask for.
 */
export function AppFooter(): React.JSX.Element {
  return (
    <footer className={styles.footer}>
      <nav className={styles.links} aria-label="Legal and support">
        {LEGAL_DOCUMENTS.map((document) => (
          <NavLink key={document.path} to={document.path} className={cx(styles.link)}>
            {document.label}
          </NavLink>
        ))}
      </nav>
      <span className={styles.version} data-testid="build-version">
        {isDesktop() ? "Desktop" : "Web"} {clientConfig.clientVersion}
      </span>
    </footer>
  );
}
