"""Migration: Move environment configuration from AgentConfiguration to ChatSession.

This migration:
1. Adds environment_type and environment_config columns to chat_sessions table
2. Removes environment_type and environment_config columns from agent_configurations table

Run this script after updating the database models but before starting the server.
"""

import sys
import asyncio
from pathlib import Path

# Add parent directory to path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


async def migrate():
    """Run the migration."""
    database_url = settings.database_url
    engine = create_async_engine(database_url, echo=True)

    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        print("\n=== Starting Migration ===\n")

        # Step 1: Add columns to chat_sessions
        print("Step 1: Adding environment_type and environment_config to chat_sessions...")
        try:
            await session.execute(text(
                "ALTER TABLE chat_sessions ADD COLUMN environment_type VARCHAR(50)"
            ))
            print("✓ Added environment_type column")
        except Exception as e:
            print(f"⚠ environment_type column may already exist: {e}")

        try:
            await session.execute(text(
                "ALTER TABLE chat_sessions ADD COLUMN environment_config JSON"
            ))
            print("✓ Added environment_config column")
        except Exception as e:
            print(f"⚠ environment_config column may already exist: {e}")

        await session.commit()

        # Step 2: Create backup of agent_configurations (just in case)
        print("\nStep 2: Creating backup of agent_configurations...")
        try:
            await session.execute(text(
                """
                CREATE TABLE IF NOT EXISTS agent_configurations_backup AS
                SELECT * FROM agent_configurations
                """
            ))
            await session.commit()
            print("✓ Backup created")
        except Exception as e:
            print(f"⚠ Backup may already exist: {e}")

        # Step 3: Remove columns from agent_configurations
        print("\nStep 3: Removing environment columns from agent_configurations...")
        print("Note: SQLite doesn't support DROP COLUMN directly, so we need to recreate the table")

        try:
            # SQLite doesn't support DROP COLUMN, so we need to:
            # 1. Create new table without environment columns
            # 2. Copy data
            # 3. Drop old table
            # 4. Rename new table

            await session.execute(text(
                """
                CREATE TABLE agent_configurations_new (
                    id VARCHAR(36) PRIMARY KEY,
                    project_id VARCHAR(36) NOT NULL UNIQUE,
                    agent_type VARCHAR(50) NOT NULL DEFAULT 'code_agent',
                    system_instructions TEXT,
                    enabled_tools JSON NOT NULL,
                    llm_provider VARCHAR(50) NOT NULL DEFAULT 'openai',
                    llm_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4',
                    llm_config JSON NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
                """
            ))

            await session.execute(text(
                """
                INSERT INTO agent_configurations_new
                    (id, project_id, agent_type, system_instructions, enabled_tools,
                     llm_provider, llm_model, llm_config)
                SELECT
                    id, project_id, agent_type, system_instructions, enabled_tools,
                    llm_provider, llm_model, llm_config
                FROM agent_configurations
                """
            ))

            await session.execute(text("DROP TABLE agent_configurations"))
            await session.execute(text("ALTER TABLE agent_configurations_new RENAME TO agent_configurations"))

            await session.commit()
            print("✓ Removed environment columns from agent_configurations")

        except Exception as e:
            print(f"✗ Error removing columns: {e}")
            await session.rollback()
            raise

        print("\n=== Migration Complete ===\n")
        print("Summary:")
        print("  • Added environment_type to chat_sessions")
        print("  • Added environment_config to chat_sessions")
        print("  • Removed environment_type from agent_configurations")
        print("  • Removed environment_config from agent_configurations")
        print("  • Backup table agent_configurations_backup created")
        print("\nEnvironment setup is now handled per-session by the agent.")
        print("Users no longer need to configure environments upfront.")

    await engine.dispose()


if __name__ == "__main__":
    print("=" * 60)
    print("Database Migration: Environment Config to Chat Sessions")
    print("=" * 60)

    response = input("\nThis will modify your database. Continue? (yes/no): ")
    if response.lower() not in ["yes", "y"]:
        print("Migration cancelled.")
        sys.exit(0)

    try:
        asyncio.run(migrate())
        print("\n✓ Migration completed successfully!")
    except Exception as e:
        print(f"\n✗ Migration failed: {e}")
        sys.exit(1)
