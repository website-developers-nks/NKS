import { Schema, model, Document, Types } from 'mongoose';

export interface IDriveFolderTarget {
  folderId: string;
  folderName?: string;
}

export interface IDriveConfig extends Document {
  name: string;
  mapping: Map<string, IDriveFolderTarget>;
  defaultFolderId?: string;
  defaultFolderName?: string;
  createdBy?: Types.ObjectId;
  lastSyncAt?: Date;
  lastError?: string;
  fileCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const FolderTargetSchema = new Schema<IDriveFolderTarget>(
  {
    folderId: { type: String, required: true, trim: true },
    folderName: { type: String, trim: true },
  },
  { _id: false },
);

const DriveConfigSchema = new Schema<IDriveConfig>(
  {
    name: { type: String, required: true, trim: true },
    mapping: { type: Map, of: FolderTargetSchema, default: () => new Map() },
    defaultFolderId: { type: String, trim: true },
    defaultFolderName: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastSyncAt: { type: Date },
    lastError: { type: String },
    fileCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const DriveConfig = model<IDriveConfig>('DriveConfig', DriveConfigSchema);
