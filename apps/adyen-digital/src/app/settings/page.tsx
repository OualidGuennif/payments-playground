import { DigitalLayout } from "@/components/Layout.tsx";
import ProfileManager from "@/components/settings/ProfileManager.tsx";

export default function SettingsPage() {
  return (
    <DigitalLayout path="/settings">
      <header className="page-intro page-intro--narrow">
        <h1>Settings</h1>
        <p>Your Adyen TEST connection and the credential profiles the playground can use.</p>
      </header>
      <ProfileManager />
    </DigitalLayout>
  );
}
