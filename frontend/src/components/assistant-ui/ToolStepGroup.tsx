/**
 * ToolStepGroup - Groups consecutive tool calls into collapsible steps
 *
 * Groups tools by their semantic purpose:
 * - Setup: environment setup
 * - Read: file_read, search
 * - Write: file_write, edit_lines
 * - Run: bash execution
 * - Think: reasoning/planning
 */

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { ContentBlock } from '@/types';
import { DefaultToolFallback } from './DefaultToolFallback';

// Streaming tool part from AssistantUIMessage
interface StreamingToolPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: any;
  argsText: string;
  result?: any;
  isError?: boolean;
  status: { type: string };
}

interface ToolStepGroupProps {
  toolBlocks: ContentBlock[];
  streamingTools?: StreamingToolPart[];
  isStreaming?: boolean;
}

interface ToolStep {
  id: string;
  stepNumber: number;
  label: string;
  icon: string;
  toolCalls: {
    block: ContentBlock;
    result?: ContentBlock;
  }[];
  hasError: boolean;
  isComplete: boolean;
  isRunning: boolean;
}

/**
 * Determine the step label for a tool call
 */
function getStepLabel(toolName: string): { label: string; icon: string } {
  const name = toolName?.toLowerCase() || '';

  if (name.includes('setup') || name.includes('environment')) {
    return { label: 'Setup', icon: '🚀' };
  }
  if (name === 'file_read' || name === 'search') {
    return { label: 'Read', icon: '📖' };
  }
  if (name === 'file_write' || name === 'edit_lines' || name === 'edit') {
    return { label: 'Edit', icon: '✏️' };
  }
  if (name === 'bash') {
    return { label: 'Run', icon: '▶️' };
  }
  if (name === 'think') {
    return { label: 'Think', icon: '💭' };
  }
  return { label: 'Action', icon: '🔧' };
}

/**
 * Group tool blocks into semantic steps
 */
function groupToolsIntoSteps(toolBlocks: ContentBlock[]): ToolStep[] {
  const steps: ToolStep[] = [];

  // Build a map of tool results by parent_block_id
  const resultsMap = new Map<string, ContentBlock>();
  for (const block of toolBlocks) {
    if (block.block_type === 'tool_result' && block.parent_block_id) {
      resultsMap.set(block.parent_block_id, block);
    }
  }

  // Get only tool_call blocks, sorted by sequence
  const toolCalls = toolBlocks
    .filter(b => b.block_type === 'tool_call')
    .sort((a, b) => a.sequence_number - b.sequence_number);

  let currentStep: ToolStep | null = null;
  let stepCounter = 0;

  for (const block of toolCalls) {
    const content = block.content as any;
    const toolName = content?.tool_name || '';
    const { label, icon } = getStepLabel(toolName);
    const result = resultsMap.get(block.id);
    const resultContent = result?.content as any;

    const isError = resultContent ? !resultContent.success : false;
    const isComplete = content?.status === 'complete' || !!result;
    const isRunning = content?.status !== 'complete' && !result;

    // Start a new step if label changes
    if (!currentStep || currentStep.label !== label) {
      if (currentStep) {
        steps.push(currentStep);
      }
      stepCounter++;
      currentStep = {
        id: `step-${stepCounter}-${block.id}`,
        stepNumber: stepCounter,
        label,
        icon,
        toolCalls: [],
        hasError: false,
        isComplete: true,
        isRunning: false,
      };
    }

    // Add tool call to current step
    currentStep.toolCalls.push({ block, result });

    // Update step status
    if (isError) currentStep.hasError = true;
    if (!isComplete) currentStep.isComplete = false;
    if (isRunning) currentStep.isRunning = true;
  }

  // Push the last step
  if (currentStep) {
    steps.push(currentStep);
  }

  return steps;
}

/**
 * Single step component
 */
const StepComponent: React.FC<{
  step: ToolStep;
  defaultExpanded?: boolean;
  forceCollapsed?: boolean;
}> = ({ step, defaultExpanded = false, forceCollapsed = false }) => {
  // Only expand if running (and not force collapsed) or explicitly defaultExpanded
  const [isExpanded, setIsExpanded] = useState(
    !forceCollapsed && (defaultExpanded || step.isRunning)
  );

  // When forceCollapsed changes, collapse the step
  useEffect(() => {
    if (forceCollapsed && isExpanded) {
      setIsExpanded(false);
    }
  }, [forceCollapsed]);

  // When step starts running, expand it
  useEffect(() => {
    if (step.isRunning && !forceCollapsed) {
      setIsExpanded(true);
    }
  }, [step.isRunning, forceCollapsed]);

  // Get step status icon
  const getStatusIcon = () => {
    if (step.isRunning) return '⏳';
    if (step.hasError) return '❌';
    if (step.isComplete) return '✅';
    return '⏳';
  };

  return (
    <div style={{
      marginBottom: '8px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      overflow: 'hidden',
      background: step.hasError ? '#fef2f2' : '#ffffff',
    }}>
      {/* Step Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '10px 14px',
          background: step.isRunning
            ? 'linear-gradient(to right, #fef3c7, #fde68a)'
            : step.hasError
              ? '#fef2f2'
              : '#f9fafb',
          borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {/* Expand/Collapse chevron */}
        <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}>
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>

        {/* Step icon */}
        <span style={{ fontSize: '14px' }}>{step.icon}</span>

        {/* Step label */}
        <strong style={{ color: '#111827', fontSize: '13px' }}>
          Step {step.stepNumber}: {step.label}
        </strong>

        {/* Tool count */}
        <span style={{
          fontSize: '11px',
          color: '#6b7280',
          background: '#e5e7eb',
          padding: '2px 8px',
          borderRadius: '10px',
        }}>
          {step.toolCalls.length} action{step.toolCalls.length !== 1 ? 's' : ''}
        </span>

        {/* Status */}
        <span style={{ marginLeft: 'auto', fontSize: '14px' }}>
          {getStatusIcon()}
        </span>

        {step.isRunning && (
          <span style={{
            fontSize: '11px',
            color: '#92400e',
            fontWeight: 500,
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}>
            Running...
          </span>
        )}
      </div>

      {/* Expanded content - individual tool calls */}
      {isExpanded && (
        <div style={{ padding: '8px' }}>
          {step.toolCalls.map(({ block, result }) => {
            const content = block.content as any;
            const resultContent = result?.content as any;
            const resultMetadata = result?.block_metadata as any;

            // Build result value
            let resultValue: any = resultContent?.result || resultContent?.error;
            const isBinary = resultContent?.is_binary || resultMetadata?.is_binary;
            const binaryData = resultContent?.binary_data || resultMetadata?.image_data;

            if (isBinary && binaryData) {
              resultValue = {
                is_binary: true,
                type: 'image',
                image_data: binaryData,
                text: resultContent?.result || '',
              };
            }

            return (
              <DefaultToolFallback
                key={block.id}
                toolCallId={block.id}
                toolName={content?.tool_name || 'unknown'}
                args={content?.arguments || {}}
                argsText={JSON.stringify(content?.arguments || {}, null, 2)}
                result={resultValue}
                isError={resultContent ? !resultContent.success : false}
                status={{ type: result ? 'complete' : 'running' }}
                addResult={() => {}}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Main component that renders grouped tool steps
 */
export const ToolStepGroup: React.FC<ToolStepGroupProps> = ({
  toolBlocks,
  streamingTools = [],
  isStreaming = false,
}) => {
  const steps = useMemo(() => groupToolsIntoSteps(toolBlocks), [toolBlocks]);

  // Check if we have streaming tools that aren't persisted yet
  const hasStreamingTools = streamingTools.length > 0;

  if (steps.length === 0 && !hasStreamingTools) {
    return null;
  }

  // If only 1-2 tool calls total (including streaming), don't group - show inline
  const totalTools = steps.reduce((sum, s) => sum + s.toolCalls.length, 0) + streamingTools.length;
  if (totalTools <= 2) {
    return (
      <>
        {steps.map(step =>
          step.toolCalls.map(({ block, result }) => {
            const content = block.content as any;
            const resultContent = result?.content as any;
            const resultMetadata = result?.block_metadata as any;

            let resultValue: any = resultContent?.result || resultContent?.error;
            const isBinary = resultContent?.is_binary || resultMetadata?.is_binary;
            const binaryData = resultContent?.binary_data || resultMetadata?.image_data;

            if (isBinary && binaryData) {
              resultValue = {
                is_binary: true,
                type: 'image',
                image_data: binaryData,
                text: resultContent?.result || '',
              };
            }

            return (
              <DefaultToolFallback
                key={block.id}
                toolCallId={block.id}
                toolName={content?.tool_name || 'unknown'}
                args={content?.arguments || {}}
                argsText={JSON.stringify(content?.arguments || {}, null, 2)}
                result={resultValue}
                isError={resultContent ? !resultContent.success : false}
                status={{ type: result ? 'complete' : 'running' }}
                addResult={() => {}}
              />
            );
          })
        )}
        {/* Render streaming tools that aren't persisted yet */}
        {streamingTools.map(tool => (
          <DefaultToolFallback
            key={tool.toolCallId}
            toolCallId={tool.toolCallId}
            toolName={tool.toolName}
            args={tool.args}
            argsText={tool.argsText}
            result={tool.result}
            isError={tool.isError}
            status={tool.status as any}
            addResult={() => {}}
          />
        ))}
      </>
    );
  }

  // Find the index of the currently running step (if any)
  // If we have streaming tools, consider them as running
  const runningStepIndex = hasStreamingTools
    ? steps.length  // All persisted steps should collapse
    : steps.findIndex(s => s.isRunning);

  // Group into steps
  return (
    <div className="tool-steps">
      {steps.map((step, index) => (
        <StepComponent
          key={step.id}
          step={step}
          // Expand last step by default if streaming (and no streaming tools)
          defaultExpanded={isStreaming && !hasStreamingTools && index === steps.length - 1}
          // Collapse previous steps when a new step is running or streaming tools exist
          forceCollapsed={runningStepIndex >= 0 && index < runningStepIndex}
        />
      ))}
      {/* Render streaming tools that aren't persisted yet */}
      {streamingTools.length > 0 && (
        <div style={{
          marginBottom: '8px',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          overflow: 'hidden',
          background: 'linear-gradient(to right, #fef3c7, #fde68a)',
        }}>
          <div style={{
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <span style={{ fontSize: '14px' }}>⏳</span>
            <strong style={{ color: '#92400e', fontSize: '13px' }}>
              Processing...
            </strong>
            <span style={{
              fontSize: '11px',
              color: '#92400e',
              fontWeight: 500,
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}>
              {streamingTools.length} tool{streamingTools.length !== 1 ? 's' : ''} streaming
            </span>
          </div>
          <div style={{ padding: '8px', background: '#ffffff' }}>
            {streamingTools.map(tool => (
              <DefaultToolFallback
                key={tool.toolCallId}
                toolCallId={tool.toolCallId}
                toolName={tool.toolName}
                args={tool.args}
                argsText={tool.argsText}
                result={tool.result}
                isError={tool.isError}
                status={tool.status as any}
                addResult={() => {}}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
