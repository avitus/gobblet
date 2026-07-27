import { Card } from "@gobblet/design-system";
import type { LegalDocument } from "../legal/content";
import styles from "./LegalScreen.module.css";

/**
 * One renderer for the three documents of
 * docs/adr/0040-legal-and-support-pages-are-routes-in-the-client.md. They differ in
 * their words, not in their shape, so there is one component and one stylesheet.
 */
export function LegalScreen({
  document,
}: Readonly<{ document: LegalDocument }>): React.JSX.Element {
  return (
    <Card title={document.title}>
      <article className={styles.document} data-testid={`legal-${document.slug}`}>
        <p className={styles.intro}>{document.intro}</p>
        <p className={styles.updated}>
          Last updated <time dateTime={document.updated}>{document.updated}</time>
        </p>
        {document.sections.map((section) => (
          <section key={section.heading} className={styles.section}>
            <h3 className={styles.heading}>{section.heading}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className={styles.paragraph}>
                {paragraph}
              </p>
            ))}
            {section.bullets !== undefined && (
              <ul className={styles.bullets}>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>
    </Card>
  );
}
