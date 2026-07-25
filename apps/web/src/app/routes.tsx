import { Route, Routes } from "react-router";
import { HomeScreen } from "../screens/HomeScreen";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { SignInScreen } from "../screens/SignInScreen";
import { VerifyEmailScreen } from "../screens/VerifyEmailScreen";
import { AppShell } from "./AppShell";

export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeScreen />} />
        <Route path="sign-in" element={<SignInScreen />} />
        <Route path="register" element={<RegisterScreen />} />
        <Route path="verify-email" element={<VerifyEmailScreen />} />
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  );
}
