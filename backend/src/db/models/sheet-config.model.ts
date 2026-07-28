import { Schema, model, Document, Types } from 'mongoose';

export interface ISheetConfig extends Document {
  name: string;
  spreadsheetId: string;
  tabName: string;
  spreadsheetTitle?: string;
  createdBy?: Types.ObjectId;
  lastAppendAt?: Date;
  lastError?: string;
  appendCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const SheetConfigSchema = new Schema<ISheetConfig>(
  {
    name: { type: String, required: true, trim: true },
    spreadsheetId: { type: String, required: true, trim: true },
    tabName: { type: String, required: true, trim: true, default: 'Sheet1' },
    spreadsheetTitle: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastAppendAt: { type: Date },
    lastError: { type: String },
    appendCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

SheetConfigSchema.index({ spreadsheetId: 1, tabName: 1 }, { unique: true });

export const SheetConfig = model<ISheetConfig>('SheetConfig', SheetConfigSchema);
