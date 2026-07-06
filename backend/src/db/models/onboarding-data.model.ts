import { Schema, model, Document, Types } from 'mongoose';
import { IUser } from './user.model';
import { IOnboardingAuth } from './onboarding-auth.model';
import { IDoc } from './doc.model';

export enum BirthdayPref {
  TeamWishes = 'team_wishes',
  Private = 'private',
  SmallCelebration = 'small_celebration',
}

export enum MealPreference {
  Vegetarian = 'vegetarian',
  Vegan = 'vegan',
  NonVegetarian = 'non_vegetarian',
  Other = 'other',
}

export enum MaritalStatus {
  Unmarried = 'unmarried',
  Married = 'married',
  Other = 'other',
}

export enum BloodGroup {
  APositive = 'A+',
  ANegative = 'A-',
  BPositive = 'B+',
  BNegative = 'B-',
  ABPositive = 'AB+',
  ABNegative = 'AB-',
  OPositive = 'O+',
  ONegative = 'O-',
}

export enum InsuranceCoverage {
  EmployeeParents = 'employee_parents',
  EmployeeSpouseKids = 'employee_spouse_kids',
}

export interface IChildInfo {
  name: string;
  dob: Date;
}

export interface IOrg {
  name: string;
  duration: string;
  role?: string;
  info?: string;
  current: boolean;
}

export interface IAddressDetails {
  address: string;
  city: string;
  country: string;
  pincode: string;
}

export interface IOnboardingData extends Document {
  userId: Types.ObjectId | IUser;
  onboardingAuthId: Types.ObjectId | IOnboardingAuth;

  welcomeAck: boolean;

  // Personal
  fullName: string;
  preferredName?: string;
  personalEmail: string;
  mobile: string;
  dob: Date;
  nationality?: string;
  maritalStatus?: MaritalStatus;
  bloodGroup?: BloodGroup;
  emergencyContactName: string;
  emergencyContactNumber: string;
  passportNumber: string;
  ssn: string;
  address: IAddressDetails;
  presentAddress?: IAddressDetails;

  // Family
  fathersName?: string;
  fathersDob?: Date;
  mothersName?: string;
  mothersDob?: Date;
  spouseName?: string;
  spouseDob?: Date;
  childsInfo?: IChildInfo[];

  // Insurance
  insuranceCoverage?: InsuranceCoverage;

  // Identity & address docs
  panDoc?: Types.ObjectId | IDoc;
  idDoc?: Types.ObjectId | IDoc;
  addressDoc?: Types.ObjectId | IDoc;
  photoDoc?: Types.ObjectId | IDoc;

  // Education
  higherSecondaryDoc?: Types.ObjectId | IDoc;
  highestDegreeDoc?: Types.ObjectId | IDoc;
  campusName?: string;

  // Employment history
  orgs?: IOrg[];

  // Employment docs (current org)
  resumeDoc?: Types.ObjectId | IDoc;
  offerLetterDoc?: Types.ObjectId | IDoc;
  lastIncrementDoc?: Types.ObjectId | IDoc;
  salarySlipDoc?: Types.ObjectId | IDoc;
  bonusLetterDoc?: Types.ObjectId | IDoc;
  experienceLetterDoc?: Types.ObjectId | IDoc;
  relievingLetterDoc?: Types.ObjectId | IDoc;

  // Bank
  bankName?: string;
  accountHolder?: string;
  accountNumber?: string;
  ifsc?: string;
  bankDoc?: Types.ObjectId | IDoc;

  // About
  introLine?: string;
  birthdayPref?: BirthdayPref;
  mealPreference?: MealPreference;
  hobbies?: string;
  funFact?: string;

  // Declaration & Consent
  declaration: boolean;
  consent: boolean;

  // Tracking
  fieldUpdateCounts: Map<string, number>;

  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ChildInfoSchema = new Schema<IChildInfo>({ name: { type: String, trim: true, required: true }, dob: { type: Date, required: true } }, { _id: false });
const OrgSchema = new Schema<IOrg>({ name: { type: String, trim: true, required: true }, duration: { type: String, trim: true, required: true }, role: { type: String, trim: true }, info: { type: String, trim: true }, current: { type: Boolean, required: true } }, { _id: false });
const AddressDetailsSchema = new Schema<IAddressDetails>({ address: { type: String, trim: true }, city: { type: String, trim: true }, country: { type: String, trim: true }, pincode: { type: String, trim: true } }, { _id: false });

const OnboardingDataSchema = new Schema<IOnboardingData>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    onboardingAuthId: { type: Schema.Types.ObjectId, ref: 'OnboardingAuth', required: true, unique: true },

    welcomeAck: { type: Boolean, default: false },

    // Personal
    fullName: { type: String, trim: true },
    preferredName: { type: String, trim: true },
    personalEmail: { type: String, lowercase: true, trim: true },
    mobile: { type: String, trim: true },
    dob: { type: Date },
    nationality: { type: String, trim: true },
    maritalStatus: { type: String, enum: Object.values(MaritalStatus) },
    bloodGroup: { type: String, enum: Object.values(BloodGroup) },
    emergencyContactName: { type: String, trim: true },
    emergencyContactNumber: { type: String, trim: true },
    passportNumber: { type: String, trim: true },
    ssn: { type: String, trim: true },
    address: { type: AddressDetailsSchema },
    presentAddress: { type: AddressDetailsSchema },

    // Family
    fathersName: { type: String, trim: true },
    fathersDob: { type: Date },
    mothersName: { type: String, trim: true },
    mothersDob: { type: Date },
    spouseName: { type: String, trim: true },
    spouseDob: { type: Date },
    childsInfo: { type: [ChildInfoSchema], default: undefined },

    // Insurance
    insuranceCoverage: { type: String, enum: Object.values(InsuranceCoverage) },

    // Identity & address docs
    panDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },
    idDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },
    addressDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },
    photoDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },

    // Education
    higherSecondaryDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },
    highestDegreeDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },
    campusName: { type: String, trim: true }, //dubai

    // Employment history
    orgs: { type: [OrgSchema], default: undefined },

    // Employment docs (current org)
    resumeDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },
    offerLetterDoc: { type: Schema.Types.ObjectId, ref: 'Doc' }, //dubai
    lastIncrementDoc: { type: Schema.Types.ObjectId, ref: 'Doc' }, //dubai
    salarySlipDoc: { type: Schema.Types.ObjectId, ref: 'Doc' }, //dubai
    bonusLetterDoc: { type: Schema.Types.ObjectId, ref: 'Doc' }, //dubai
    experienceLetterDoc: { type: Schema.Types.ObjectId, ref: 'Doc' }, //dubai
    relievingLetterDoc: { type: Schema.Types.ObjectId, ref: 'Doc' }, //dubai

    // Bank
    bankName: { type: String, trim: true },
    accountHolder: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifsc: { type: String, uppercase: true, trim: true },
    bankDoc: { type: Schema.Types.ObjectId, ref: 'Doc' },

    // About
    introLine: { type: String, trim: true },
    birthdayPref: { type: String, enum: Object.values(BirthdayPref) },
    mealPreference: { type: String, enum: Object.values(MealPreference) },
    hobbies: { type: String, trim: true },
    funFact: { type: String, trim: true },

    // Declaration & Consent
    declaration: { type: Boolean, default: false },
    consent: { type: Boolean, default: false },

    // Tracking
    fieldUpdateCounts: { type: Map, of: Number, default: new Map() },

    submittedAt: { type: Date },
  },
  { timestamps: true },
);

export const OnboardingData = model<IOnboardingData>('OnboardingData', OnboardingDataSchema);
