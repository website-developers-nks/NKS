import { Schema, model, Document } from 'mongoose';

export enum Permission {
  ManageUsers = 'manage_users',
  DeleteUsers = 'delete_users',
  ManagePermissions = 'manage_permissions',
  EmailUsers = 'email_users',
  ManageOnboardings = 'manage_onboardings',
  ExpireOnboardings = 'expire_onboardings',
  ViewOnboardingList = 'view_onboarding_list',
  ViewOnboardingResults = 'view_onboarding_results',
  ViewOnboardingDocs = 'view_onboarding_docs',
  ExportOnboardingData = 'export_onboarding_data',
  ManageSheets = 'manage_sheets',
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.ManageUsers]: 'Manage Users',
  [Permission.DeleteUsers]: 'Delete Users',
  [Permission.ManagePermissions]: 'Manage Permissions',
  [Permission.EmailUsers]: 'Email Users',
  [Permission.ManageOnboardings]: 'Manage Onboardings',
  [Permission.ExpireOnboardings]: 'Expire Onboardings',
  [Permission.ViewOnboardingList]: 'View Onboarding List',
  [Permission.ViewOnboardingResults]: 'View Onboarding Results',
  [Permission.ViewOnboardingDocs]: 'View Onboarding Docs',
  [Permission.ExportOnboardingData]: 'Export Onboarding Data',
  [Permission.ManageSheets]: 'Manage Google Sheets',
};

export interface IPermissionGroup extends Document {
  name: string;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

const PermissionGroupSchema = new Schema<IPermissionGroup>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    permissions: {
      type: [{ type: String, enum: Object.values(Permission) }],
      default: [],
    },
  },
  { timestamps: true },
);

export const PermissionGroup = model<IPermissionGroup>('PermissionGroup', PermissionGroupSchema);
