from typing import TypedDict, Annotated, Sequence
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_community.chat_models import ChatOllama
from agents.tools import process_receipt, process_delivery, process_transfer, process_adjustment
import json

# Bind local Ollama model (llama3.1)
# Note: Ensure Ollama is running locally and has the llama3.1 model pulled
llm = ChatOllama(model="llama3.1", temperature=0)

tools = [process_receipt, process_delivery, process_transfer, process_adjustment]
llm_with_tools = llm.bind_tools(tools)

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], "add_messages"]
    intent: str

def coordinator_agent(state: AgentState):
    """Parses intent and routes to tools."""
    messages = state["messages"]
    response = llm_with_tools.invoke(messages)
    return {"messages": [response]}

def tool_executor(state: AgentState):
    """Executes the tool called by the LLM."""
    messages = state["messages"]
    last_message = messages[-1]
    
    tool_responses = []
    if last_message.tool_calls:
        for tool_call in last_message.tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            
            # Map tool names to actual functions
            tool_map = {
                "process_receipt": process_receipt,
                "process_delivery": process_delivery,
                "process_transfer": process_transfer,
                "process_adjustment": process_adjustment
            }
            
            if tool_name in tool_map:
                try:
                    result = tool_map[tool_name].invoke(tool_args)
                    tool_responses.append(AIMessage(content=str(result)))
                except Exception as e:
                    tool_responses.append(AIMessage(content=f"Error: {str(e)}"))
                    
    return {"messages": tool_responses}

def should_continue(state: AgentState):
    messages = state["messages"]
    last_message = messages[-1]
    
    if last_message.tool_calls:
        return "tools"
    return END

# Build the Graph
workflow = StateGraph(AgentState)

workflow.add_node("agent", coordinator_agent)
workflow.add_node("tools", tool_executor)

workflow.set_entry_point("agent")
workflow.add_conditional_edges(
    "agent",
    should_continue,
    {
        "tools": "tools",
        END: END
    }
)
workflow.add_edge("tools", "agent")

app = workflow.compile()

# Helper function to run the agent
def run_agent(user_input: str):
    inputs = {"messages": [HumanMessage(content=user_input)]}
    result = app.invoke(inputs)
    return result["messages"][-1].content
