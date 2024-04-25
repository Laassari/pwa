import cp from 'child_process'
import ffmpeg from 'ffmpeg-static'
import ytdl from 'ytdl-core'

export const QUALITY_ITAG_MAP_1080p = {
  // webm: {
  //   audio: [251],
  //   video: [248],
  // },
  mp4: {
    audio: [140, 141],
    video: [137, 299, 399],
  },
}

export async function downloadHighestQualityVideo(url, res) {
  const info = await ytdl.getInfo(url)

  const has1080 =
    info.formats.findIndex(
      (f) => f.qualityLabel === '1080p' || f.quality === 'hd1080'
    ) > -1

  if (!has1080) return downloadLowQualityVideo(info, url, res)

  const selectedFormats = selectFormat(info.formats)

  if (!selectedFormats) return downloadLowQualityVideo(info, url, res)

  const { audioFormat, videoFormat } = selectedFormats

  const contentType =
    videoFormat.container === 'webm' ? 'video/webm' : 'video/x-matroska'

  res.header('Content-Type', contentType)
  if (videoFormat.container === 'webm') {
    res.header(
      'Content-Length',
      +audioFormat.contentLength + +videoFormat.contentLength
    )
  }

  const audio = ytdl(url, { format: audioFormat })
  const video = ytdl(url, { format: videoFormat })

  const mergeStream = mergeAudioAndVideo(audio, video, videoFormat.container)

  return mergeStream
}

export function mergeAudioAndVideo(audioStream, videoStream, outputContainer) {
  const ffmpegProcess = cp.spawn(
    ffmpeg,
    [
      // Remove ffmpeg's console spamming
      ['-loglevel', '0', '-hide_banner'],

      // Set inputs
      ['-i', 'pipe:3'],
      ['-i', 'pipe:4'],

      // Map audio & video from streams
      ['-map', '0:a'],
      ['-map', '1:v'],

      outputContainer === 'mp4' ? ['-movflags', 'isml+frag_keyframe'] : [],
      // Keep video encoding. encode audio as flac
      ['-c:v', 'copy'],
      ['-c:a', 'copy'],

      ['-f', outputContainer, 'pipe:5'],
    ].flat(),
    {
      windowsHide: true,
      stdio: [
        /* Standard: stdin, stdout, stderr */
        'inherit',
        'inherit',
        'inherit',
        /* Custom: pipe:3, pipe:4, pipe:5 */
        'pipe',
        'pipe',
        'pipe',
      ],
    }
  )

  audioStream.pipe(ffmpegProcess.stdio[3])
  videoStream.pipe(ffmpegProcess.stdio[4])

  ffmpegProcess.stdio[3].on('error', (err) => {
    console.error('audio', err)
  })
  ffmpegProcess.stdio[4].on('error', (err) => {
    console.error('video', err)
  })

  return ffmpegProcess.stdio[5]
}

function downloadLowQualityVideo(info, url, res) {
  const format = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' })

  res.header('Content-Type', format.mimeType.split(';')[0])
  res.header('Content-Length', format.contentLength)

  return ytdl(url, { format: format })
}

function selectFormat(formats = []) {
  let audioFormat, videoFormat
  for (const container in QUALITY_ITAG_MAP_1080p) {
    const { audio, video } = QUALITY_ITAG_MAP_1080p[container]
    try {
      audioFormat = formats.find((f) => audio.includes(f.itag))
      videoFormat = formats.find((f) => video.includes(f.itag))

      if (audioFormat && videoFormat) break
    } catch (error) {
      console.log('error choosing format', error)
    }
  }

  if (!audioFormat || !videoFormat) {
    console.error('No Format found')
    return null
  }

  return { audioFormat, videoFormat }
}
