import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

export interface RoomFields {
  name: string;
  slug: string;
  isDM: boolean;
  creatorId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RoomDoc = HydratedDocument<RoomFields>;

const roomSchema = new Schema<RoomFields>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 48 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    isDM: { type: Boolean, default: false },
    // null for system-seeded rooms such as #general.
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const Room = model('Room', roomSchema);
