import { create } from "zustand";

export enum LaunchState {
  IDLE = "idle",
  LAUNCHING = "launching",
  RUNNING = "running",
  ERROR = "error",
}

interface ProfileLaunchState {
  launchState: LaunchState;
  currentStep: string;
  launchProgress: number;
  error: string | null;
  logHistory: string[];
  isButtonLaunching: boolean;
  buttonStatusMessage: string | null;
}

interface LaunchStateStore {
  profiles: Record<string, ProfileLaunchState>;
  initializeProfile: (profileId: string) => void;
  setLaunchError: (profileId: string, error: string) => void;
  addLogEntry: (profileId: string, log: string) => void;
  getProfileState: (profileId: string) => ProfileLaunchState;
  setButtonStatusMessage: (profileId: string, message: string | null) => void;
  initiateButtonLaunch: (profileId: string) => void;
  finalizeButtonLaunch: (profileId: string, errorMsg?: string | null) => void;
}

export const DEFAULT_PROFILE_STATE: ProfileLaunchState = {
  launchState: LaunchState.IDLE,
  currentStep: "",
  launchProgress: 0,
  error: null,
  logHistory: [],
  isButtonLaunching: false,
  buttonStatusMessage: null,
};

export const useLaunchStateStore = create<LaunchStateStore>((set, get) => ({
  profiles: {},

  initializeProfile: (profileId: string) => {
    set((state) => {
      if (!state.profiles[profileId]) {
        return {
          ...state,
          profiles: {
            ...state.profiles,
            [profileId]: { ...DEFAULT_PROFILE_STATE },
          },
        };
      }
      return state;
    });
  },

  setLaunchError: (profileId: string, error: string) => {
    set((state) => {
      const currentProfile = state.profiles[profileId] || {
        ...DEFAULT_PROFILE_STATE,
      };

      return {
        ...state,
        profiles: {
          ...state.profiles,
          [profileId]: {
            ...currentProfile,
            launchState: LaunchState.ERROR,
            error,
            isButtonLaunching: false,
            buttonStatusMessage: error,
          },
        },
      };
    });
  },

  addLogEntry: (profileId: string, log: string) => {
    set((state) => {
      const currentProfile = state.profiles[profileId] || {
        ...DEFAULT_PROFILE_STATE,
      };
      const updatedLogHistory = [...currentProfile.logHistory, log];

      return {
        ...state,
        profiles: {
          ...state.profiles,
          [profileId]: {
            ...currentProfile,
            logHistory: updatedLogHistory,
          },
        },
      };
    });
  },

  getProfileState: (profileId: string) => {
    const state = get().profiles[profileId];
    return state || { ...DEFAULT_PROFILE_STATE };
  },

  setButtonStatusMessage: (profileId: string, message: string | null) => {
    set((state) => {
      if (!state.profiles[profileId]) {
        state.initializeProfile(profileId);
      }
      const currentProfile = state.profiles[profileId] || { ...DEFAULT_PROFILE_STATE };
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [profileId]: {
            ...currentProfile,
            buttonStatusMessage: message,
          },
        },
      };
    });
  },

  initiateButtonLaunch: (profileId: string) => {
    set((state) => {
      if (!state.profiles[profileId]) {
        state.initializeProfile(profileId);
      }
      const currentProfile = state.profiles[profileId] || { ...DEFAULT_PROFILE_STATE };
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [profileId]: {
            ...currentProfile,
            isButtonLaunching: true,
            buttonStatusMessage: "Starting profile...",
            error: null,
            launchState: LaunchState.LAUNCHING,
          },
        },
      };
    });
  },

  finalizeButtonLaunch: (profileId: string, errorMsg?: string | null) => {
    set((state) => {
      if (!state.profiles[profileId]) {
        state.initializeProfile(profileId);
      }
      const currentProfile = state.profiles[profileId] || { ...DEFAULT_PROFILE_STATE };
      const isError = typeof errorMsg === 'string' && errorMsg.length > 0;

      return {
        ...state,
        profiles: {
          ...state.profiles,
          [profileId]: {
            ...currentProfile,
            isButtonLaunching: false,
            buttonStatusMessage: isError ? errorMsg : null,
            error: isError ? errorMsg : currentProfile.error,
            launchState: isError ? LaunchState.ERROR : LaunchState.IDLE,
          },
        },
      };
    });
  },
}));
