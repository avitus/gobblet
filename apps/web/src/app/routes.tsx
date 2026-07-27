import { Route, Routes } from "react-router";
import { AdminAchievementsScreen } from "../admin/AdminAchievementsScreen";
import { AdminAuditScreen } from "../admin/AdminAuditScreen";
import { AdminGate } from "../admin/AdminGate";
import { AdminMatchScreen } from "../admin/AdminMatchScreen";
import { AdminMatchesScreen } from "../admin/AdminMatchesScreen";
import { AdminOverviewScreen } from "../admin/AdminOverviewScreen";
import { AdminUserScreen } from "../admin/AdminUserScreen";
import { AdminUsersScreen } from "../admin/AdminUsersScreen";
import { PRIVACY, SUPPORT, TERMS } from "../legal/content";
import { DownloadScreen } from "../screens/DownloadScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { LeaderboardScreen } from "../screens/LeaderboardScreen";
import { LegalScreen } from "../screens/LegalScreen";
import { MatchScreen } from "../screens/MatchScreen";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { PlayScreen } from "../screens/PlayScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SignInScreen } from "../screens/SignInScreen";
import { VerifyEmailScreen } from "../screens/VerifyEmailScreen";
import { AppShell } from "./AppShell";

export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeScreen />} />
        <Route path="play" element={<PlayScreen />} />
        <Route path="match/:matchId" element={<MatchScreen />} />
        <Route path="history" element={<HistoryScreen />} />
        <Route path="leaderboard" element={<LeaderboardScreen />} />
        <Route path="download" element={<DownloadScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="profile/:username" element={<ProfileScreen />} />
        <Route path="sign-in" element={<SignInScreen />} />
        <Route path="register" element={<RegisterScreen />} />
        <Route path="verify-email" element={<VerifyEmailScreen />} />
        <Route path="privacy" element={<LegalScreen document={PRIVACY} />} />
        <Route path="terms" element={<LegalScreen document={TERMS} />} />
        <Route path="support" element={<LegalScreen document={SUPPORT} />} />
        <Route path="admin" element={<AdminGate />}>
          <Route index element={<AdminOverviewScreen />} />
          <Route path="users" element={<AdminUsersScreen />} />
          <Route path="users/:userId" element={<AdminUserScreen />} />
          <Route path="matches" element={<AdminMatchesScreen />} />
          <Route path="matches/:matchId" element={<AdminMatchScreen />} />
          <Route path="achievements" element={<AdminAchievementsScreen />} />
          <Route path="audit" element={<AdminAuditScreen />} />
        </Route>
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  );
}
