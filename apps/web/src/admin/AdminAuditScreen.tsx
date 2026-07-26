import { Banner, Button, Card, Spinner } from "@gobblet/design-system";
import { describeApiError } from "../api/errors";
import { useAdminAudit } from "../api/queries";
import styles from "./Admin.module.css";

function describeChange(value: unknown): string {
  return value === null || value === undefined ? "-" : JSON.stringify(value);
}

/**
 * Every administrative change, newest first, exactly as it was recorded: the audit
 * log is written in the same transaction as the change and nothing edits or deletes
 * a row, so this screen only reads (appendix P7.18).
 */
export function AdminAuditScreen(): React.JSX.Element {
  const audit = useAdminAudit(true);
  const entries = (audit.data?.pages ?? []).flatMap((page) => page.entries);

  if (audit.isPending) {
    return (
      <Card title="Audit">
        <Spinner label="Reading the audit log" />
      </Card>
    );
  }

  if (audit.isError) {
    return (
      <Card title="Audit">
        <Banner tone="error">{describeApiError(audit.error)}</Banner>
      </Card>
    );
  }

  return (
    <Card title="Audit" description="Newest first. Nothing here can be changed.">
      {entries.length === 0 ? (
        <p data-testid="admin-audit-empty">Nothing has been done yet.</p>
      ) : (
        <table className={styles.table} data-testid="admin-audit-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Action</th>
              <th scope="col">By</th>
              <th scope="col">Target</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.auditId} data-testid={`admin-audit-row-${entry.auditId}`}>
                <td>{entry.createdAt.slice(0, 19).replace("T", " ")}</td>
                <td>{entry.action}</td>
                <td>{entry.adminUsername ?? "the console"}</td>
                <td>{entry.targetLabel ?? entry.targetId.slice(0, 8)}</td>
                <td>
                  <pre className={styles.payload}>{describeChange(entry.before)}</pre>
                </td>
                <td>
                  <pre className={styles.payload}>{describeChange(entry.after)}</pre>
                </td>
                <td>{entry.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {audit.hasNextPage === true && (
        <Button
          variant="secondary"
          size="sm"
          busy={audit.isFetchingNextPage}
          onClick={() => {
            void audit.fetchNextPage();
          }}
          data-testid="admin-audit-more"
        >
          Show more
        </Button>
      )}
    </Card>
  );
}
