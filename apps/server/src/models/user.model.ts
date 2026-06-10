import { Schema, model, type HydratedDocument } from 'mongoose';

export interface UserFields {
  username: string;
  passwordHash: string;
  displayName: string;
  avatarSeed: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDoc = HydratedDocument<UserFields>;

const userSchema = new Schema<UserFields>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
    },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 48 },
    avatarSeed: { type: String, required: true },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
