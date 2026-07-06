import { Schema, model, Document, Types } from 'mongoose';
import { IUser } from './user.model';

export enum DocType {
  // Identity & address
  AadharCard = 'aadhar_card',
  PanCard = 'pan_card',
  ProfilePhoto = 'profile_photo',
  AddressProof = 'address_proof',
  // Education
  HigherSecondaryMarksheet = 'higher_secondary_marksheet',
  HighestDegreeCertificate = 'highest_degree_certificate',
  // Employment (current org)
  Resume = 'resume',
  OfferLetterCurrentOrg = 'offer_letter_current_org',
  LastIncrementLetter = 'last_increment_letter',
  SalarySlip = 'salary_slip',
  BonusLetter = 'bonus_letter',
  ExperienceLetter = 'experience_letter',
  RelievingLetter = 'relieving_letter',
  // Bank
  BankProof = 'bank_proof',
}

export interface IDoc extends Document {
  userId: Types.ObjectId | IUser;
  onboardingKey: string;
  docType: DocType;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
  presignUrlCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const DocSchema = new Schema<IDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    onboardingKey: { type: String, required: true, index: true },
    docType: { type: String, enum: Object.values(DocType), required: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    path: { type: String, required: true },
    presignUrlCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

DocSchema.index({ userId: 1, docType: 1 });

export const Doc = model<IDoc>('Doc', DocSchema);
