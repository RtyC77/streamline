export const captureResolutions = [480, 720, 1080] as const;
export const captureFrameRates = [24, 30, 48, 60] as const;
export interface CaptureProfile {
 resolution: typeof captureResolutions[number];
 fps: typeof captureFrameRates[number];
 systemAudio?: boolean;
}
export const defaultProfile:CaptureProfile={resolution:720,fps:30};
const resolutionTargets = {
 480: {width:854, bitrate:1_200_000, minBitrate:400_000},
 720: {width:1280, bitrate:3_000_000, minBitrate:800_000},
 1080: {width:1920, bitrate:6_000_000, minBitrate:1_500_000},
};
export function videoProfile(profile:CaptureProfile=defaultProfile){
 if(!captureResolutions.includes(profile.resolution)||!captureFrameRates.includes(profile.fps))throw new Error('Selecione 480p, 720p ou 1080p e 24, 30, 48 ou 60 FPS.');
 if(profile.systemAudio!==undefined&&typeof profile.systemAudio!=='boolean')throw new Error('Opção de áudio inválida.');
 const {width, bitrate, minBitrate} = resolutionTargets[profile.resolution];
 return {width,height:profile.resolution,fps:profile.fps,bitrate:bitrate * Math.max(1, profile.fps / 30),minBitrate};
}
