import mongoose from 'mongoose';

const trainerRulesSchema = new mongoose.Schema(
  {
    catalogKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      enum: ['male_gym', 'male_home', 'female_gym', 'female_home'],
    },
    content: {
      type: String,
      required: true,
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

export default mongoose.model('TrainerRules', trainerRulesSchema);
