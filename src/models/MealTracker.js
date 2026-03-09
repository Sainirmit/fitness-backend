import mongoose from 'mongoose';

/**
 * MealTracker – tracks user meals with images and AI-analyzed nutritional data.
 * Images stored externally (S3/CDN), AI provides calorie/macro breakdown.
 * Supports optional user descriptions and meal categorization.
 */
const mealTrackerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    mealName: {
      type: String,
      trim: true,
      required: true,
      // e.g. "Chicken Salad", "Protein Shake", "Breakfast Bowl"
    },
    mealType: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      // e.g. "breakfast" | "lunch" | "dinner" | "snack" | "post_workout"
    },
    
    // --- User inputs ---
    imageUrl: {
      type: String,
      trim: true,
      required: true,
      // Hosted URL for meal image (S3, CDN, etc.)
    },
    description: {
      type: String,
      trim: true,
      default: '',
      // Optional user description of the meal for ai 
    },
    macroFixRequest: {
      type: String,
      trim: true,
      default: '',
      // User text request for AI to adjust macros (e.g. "add more protein", "reduce carbs")
    },
    
    // --- AI-generated nutritional data ---
    calories: {
      type: Number,
      min: 0,
      default: null,
      // Total calories in kcal
    },
    protein: {
      type: Number,
      min: 0,
      default: null,
      // Protein in grams
    },
    carbs: {
      type: Number,
      min: 0,
      default: null,
      // Carbohydrates in grams
    },
    fats: {
      type: Number,
      min: 0,
      default: null,
      // Fats in grams
    },
    
    // --- AI-adjusted nutritional data (after macro fix) ---
    adjustedCalories: {
      type: Number,
      min: 0,
      default: null,
      // AI-adjusted calories after macro fix request
    },
    adjustedProtein: {
      type: Number,
      min: 0,
      default: null,
      // AI-adjusted protein in grams after macro fix request
    },
    adjustedCarbs: {
      type: Number,
      min: 0,
      default: null,
      // AI-adjusted carbs in grams after macro fix request
    },
    adjustedFats: {
      type: Number,
      min: 0,
      default: null,
      // AI-adjusted fats in grams after macro fix request
    },
    
    // --- AI processing metadata ---
    aiProcessed: {
      type: Boolean,
      default: false,
      // True when OpenAI has analyzed the meal initially
    },
    macroFixProcessed: {
      type: Boolean,
      default: false,
      // True when OpenAI has processed macro fix request
    },
    aiConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
      // AI confidence score for initial nutritional analysis
    },
    macroFixConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
      // AI confidence score for macro fix adjustments
    },
    aiError: {
      type: String,
      trim: true,
      default: '',
      // Any error message from initial AI processing
    },
    macroFixError: {
      type: String,
      trim: true,
      default: '',
      // Any error message from macro fix AI processing
    },
    
    // --- Timing ---
    mealDateTime: {
      type: Date,
      default: Date.now,
      // When the meal was actually consumed
    },
    recordedAt: {
      type: Date,
      default: Date.now,
      // When the meal was logged in the system
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
mealTrackerSchema.index({ user: 1, mealDateTime: -1 });
mealTrackerSchema.index({ user: 1, mealType: 1 });
mealTrackerSchema.index({ user: 1, recordedAt: -1 });
mealTrackerSchema.index({ aiProcessed: 1 }); // For finding unprocessed meals
mealTrackerSchema.index({ macroFixProcessed: 1 }); // For finding meals needing macro fix

export default mongoose.model('MealTracker', mealTrackerSchema);
