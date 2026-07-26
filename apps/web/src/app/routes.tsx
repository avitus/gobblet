import { Route, Routes } from "react-router";
import { HistoryScreen } from "../screens/HistoryScreen";
import { HomeScreen } from "../screens/HomeScreen";
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
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="profile/:username" element={<ProfileScreen />} />
        <Route path="sign-in" element={<SignInScreen />} />
        <Route path="register" element={<RegisterScreen />} />
        <Route path="verify-email" element={<VerifyEmailScreen />} />
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  );
}
