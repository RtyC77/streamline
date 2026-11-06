export interface CaptureProfile {resolution:480|720;fps:24|30}
export const defaultProfile:CaptureProfile={resolution:720,fps:30};
export function videoProfile(profile:CaptureProfile=defaultProfile){
 if(![480,720].includes(profile.resolution)||![24,30].includes(profile.fps))throw new Error('Selecione 480p ou 720p e 24 ou 30 FPS.');
 const low=profile.resolution===480;
 return {width:low?854:1280,height:profile.resolution,fps:profile.fps,bitrate:low?1_200_000:3_000_000,minBitrate:low?400_000:800_000};
}
