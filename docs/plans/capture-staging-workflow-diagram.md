# Capture Staging Workflow - Visual Diagrams

## User Flow Diagram

```mermaid
flowchart TD
    A[User Records Voice] --> B[Transcript Created]
    B --> C[Extraction Runs Automatically]
    C --> D[Expandable Transcript Card]
    D --> E[Extracted Tasks in Staging Table]
    E --> F{User Reviews}
    F --> G[Approve Individual Task]
    F --> H[Discard Individual Task]
    F --> I[Approve All Tasks]
    F --> J[Discard All Tasks]
    F --> K{Edit Transcript?}
    K -->|Yes| L[Edit Transcript]
    L --> M[Re-extract Button]
    M --> C
    G --> N[Task Created in Final List]
    H --> O[Task Removed from Staging]
    I --> N
    J --> O
    E --> P{More Pending Tasks?}
    P -->|Yes| F
    P -->|No| Q[Staging Table Clears]
```

## Data Flow Diagram

```mermaid
flowchart LR
    subgraph Frontend
        A[Voice Recording] --> B[Transcript Display]
        B --> C[Staging Table UI]
        C --> D[Approve/Discard Actions]
        C --> E[Re-extract Action]
    end
    
    subgraph Backend
        F[Transcription Service] --> G[Extraction Service]
        G --> H[Staging Service]
        H --> I[Task Service]
        E --> G
    end
    
    subgraph Database
        J[Captures Table]
        K[Extracted Tasks Table]
        L[Tasks Table]
    end
    
    A --> F
    B --> J
    H --> K
    I --> L
    D --> H
    D --> I
```

## Component Architecture

```mermaid
flowchart TD
    subgraph CaptureRoute
        A[Voice Recorder]
        B[ExpandableTranscript]
        C[StagingTable]
        D[Summary Display]
    end
    
    subgraph StagingTable
        E[ExtractedTaskCard 1]
        F[ExtractedTaskCard 2]
        G[ExtractedTaskCard N]
        H[Bulk Actions]
    end
    
    subgraph ExtractedTaskCard
        I[Checkbox]
        J[Task Details]
        K[Confidence Badge]
        L[Discard Button]
    end
    
    C --> E
    C --> F
    C --> G
    C --> H
    E --> I
    E --> J
    E --> K
    E --> L
```

## Database Schema Diagram

```mermaid
erDiagram
    users ||--o{ captures : has
    users ||--o{ extracted_tasks : has
    users ||--o{ tasks : has
    users ||--o{ groups : has
    
    captures ||--o{ extracted_tasks : contains
    groups ||--o{ extracted_tasks : assigned_to
    groups ||--o{ tasks : assigned_to
    
    captures {
        uuid id PK
        uuid user_id FK
        text input_type
        text status
        text transcript_text
        timestamptz created_at
    }
    
    extracted_tasks {
        uuid id PK
        uuid user_id FK
        uuid capture_id FK
        uuid group_id FK
        text title
        text group_name
        date due_date
        float top_confidence
        boolean needs_review
        text status
        timestamptz created_at
    }
    
    tasks {
        uuid id PK
        uuid user_id FK
        uuid group_id FK
        uuid capture_id FK
        text title
        text status
        boolean needs_review
        date due_date
        timestamptz created_at
    }
    
    groups {
        uuid id PK
        uuid user_id FK
        text name
        boolean is_system
    }
```

## API Endpoint Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend
    participant DB as Database
    
    U->>F: Record Voice
    F->>B: POST /captures/voice
    B->>B: Transcribe Audio
    B->>B: Extract Tasks (Automatic)
    B->>DB: Store Capture
    B->>DB: Store Extracted Tasks
    B-->>F: Return Transcript
    
    U->>F: Edit Transcript (Optional)
    U->>F: Click Re-extract
    F->>B: POST /captures/{id}/re-extract
    B->>B: Clear Old Extracted Tasks
    B->>B: Extract Tasks Again
    B->>DB: Store New Extracted Tasks
    B-->>F: Return New Extracted Tasks
    
    U->>F: Approve Task
    F->>B: POST /captures/{id}/extracted-tasks/{taskId}/approve
    B->>DB: Create Final Task
    B->>DB: Update Extracted Task Status
    B-->>F: Return Created Task
    
    U->>F: Discard Task
    F->>B: POST /captures/{id}/extracted-tasks/{taskId}/discard
    B->>DB: Update Extracted Task Status
    B-->>F: Confirm Discard
```

## State Management

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Recording : Start Recording
    Recording --> Transcribing : Stop Recording
    Transcribing --> Extracting : Transcript Ready
    Extracting --> StagingReady : Extraction Complete
    StagingReady --> Approving : Approve Task
    StagingReady --> Discarding : Discard Task
    StagingReady --> ReExtracting : Edit & Re-extract
    Approving --> StagingReady : Task Created
    Discarding --> StagingReady : Task Removed
    ReExtracting --> Extracting : Re-extract
    StagingReady --> Idle : All Tasks Resolved
    
    note right of StagingReady : Persists across page reloads
    note right of StagingReady : Multiple transcripts add here
```

## Confidence Badge Logic

```mermaid
flowchart TD
    A[Extracted Task] --> B{Confidence Score}
    B -->|>= 0.7| C[High Confidence]
    B -->|< 0.7| D[Low Confidence]
    C --> E[No Badge]
    D --> F[Needs Review Badge]
    
    style F fill:#ff6b6b,color:#fff
    style E fill:#51cf66,color:#fff
```

## Persistence Strategy

```mermaid
flowchart TD
    A[Page Load] --> B[Fetch Session]
    B --> C[Fetch Pending Extracted Tasks]
    C --> D{Pending Tasks Exist?}
    D -->|Yes| E[Show Staging Table]
    D -->|No| F[Show Empty State]
    
    G[New Transcript] --> H[Extract Tasks]
    H --> I[Add to Staging Table]
    I --> E
    
    J[Approve/Discard] --> K[Update Staging Table]
    K --> L{All Resolved?}
    L -->|Yes| F
    L -->|No| E
```
