"use client";

import { ProfileSettingsForm } from "@/components/settings/ProfileSettingsForm";
import { useAppUser } from "@/contexts/AppUserContext";

export default function SettingsPage(): React.ReactElement {
  const user = useAppUser();

  return (
    <ProfileSettingsForm
      initialName={user.name}
      email={user.email}
      roleCode={user.role}
      roleNameFromDb={user.roleNameFromDb}
    />
  );
}
