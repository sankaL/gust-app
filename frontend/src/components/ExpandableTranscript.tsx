import { useState } from 'react'

interface ExpandableTranscriptProps {
  transcript: string
  snippetLength?: number
}

export function ExpandableTranscript({
  transcript,
  snippetLength = 100
}: ExpandableTranscriptProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const shouldTruncate = transcript.length > snippetLength
  const displayText = isExpanded
    ? transcript
    : transcript.slice(0, snippetLength)

  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-300">Voice Transcript</h3>
        {shouldTruncate && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      <div className="text-sm text-gray-200 whitespace-pre-wrap">
        {displayText}
        {!isExpanded && shouldTruncate && '...'}
      </div>
    </div>
  )
}
