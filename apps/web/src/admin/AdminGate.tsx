import { Card, Spinner } from "@gobblet/design-system";
import { NavLink, Outlet } from "react-router";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { useAdminAccess } from "./useAdminAccess";
import styles from "./Admin.module.css";

type AdminLink = Readonly<{ to: string; label: string; end?: boolean }>;

const SECTIONS: readonly AdminLink[] = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/users", label: "Accounts" },
  { to: "/admin/matches", label: "Matches" },
  { to: "/admin/achievements", label: "Achievements" },
  { to: "/admin/audit", label: "Audit" },
];

/**
 * The dashboard's entrance. A player, a guest and a signed-out reader all see the
 * same "nothing here" the address would give them anyway, so the surface does not
 * announce that it exists (appendix P7.1); the server refuses them regardless.
 */
export function AdminGate(): React.JSX.Element {
  const access = useAdminAccess();

  if (access.allowed === null) {
    return (
      <Card title="Administration">
        <Spinner label="Checking your account" />
      </Card>
    );
  }

  if (!access.allowed) {
    return <NotFoundScreen />;
  }

  return (
    <div className={styles.layout} data-testid="admin-dashboard">
      <nav className={styles.sections} aria-label="Administration">
        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end ?? false}
            className={({ isActive }) => (isActive ? styles.sectionActive : styles.section)}
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
