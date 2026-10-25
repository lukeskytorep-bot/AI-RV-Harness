-- STEP 5A: durable Conversation attachment/source delivery metadata.
-- Image bytes remain transient and are never copied into chat history.
ALTER TABLE chat_messages ADD COLUMN metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json));
