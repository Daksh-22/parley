import { Schema, model, type Types, type HydratedDocument } from 'mongoose';

export interface RoomFields {
  name: string;
  slug: string;
  isDM: boolean;
  creatorId: Types.ObjectId | null;
  // Per-room memory switch. When false, nothing from this room is embedded,
  // retrieved, or sent to a model.
  aiEnabled: boolean;
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
    aiEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Room directory listing: public rooms paginated by _id.
roomSchema.index({ isDM: 1, _id: 1 });
// Room creation ceiling: count rooms created by a user.
roomSchema.index({ creatorId: 1 });

export const Room = model('Room', roomSchema);
