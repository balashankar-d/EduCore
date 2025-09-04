import React, { useState, useRef, useEffect } from 'react';
import './ChatComponent.css';

const ChatComponent = ({ 
    messages = [], 
    typingUsers = [], 
    onSendMessage, 
    onTyping, 
    currentUserRole = 'student',
    currentUserName = 'User'
}) => {
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef(null);
    const typingTimeoutRef = useRef(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleInputChange = (e) => {
        const value = e.target.value;
        setInputMessage(value);

        // Handle typing indicator
        if (value.length > 0 && !isTyping) {
            setIsTyping(true);
            onTyping(true);
        }

        // Clear existing timeout
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }

        // Set new timeout to stop typing indicator
        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            onTyping(false);
        }, 1000);
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (inputMessage.trim() === '') return;

        try {
            await onSendMessage(inputMessage.trim());
            setInputMessage('');
            
            // Stop typing indicator immediately when sending
            if (isTyping) {
                setIsTyping(false);
                onTyping(false);
                if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                }
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            alert('Failed to send message. Please try again.');
        }
    };

    const formatTimestamp = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getMessageClass = (message) => {
        let className = 'message';
        if (message.isSystemMessage) {
            className += ' system-message';
        } else if (message.senderRole === currentUserRole && message.senderName === currentUserName) {
            className += ' own-message';
        } else {
            className += ' other-message';
        }
        return className;
    };

    return (
        <div className="chat-component">
            <div className="chat-header">
                <h3>Class Chat</h3>
            </div>
            
            <div className="chat-messages">
                {messages.map((message, index) => (
                    <div key={message.id || index} className={getMessageClass(message)}>
                        {message.isSystemMessage ? (
                            <div className="system-content">
                                <span className="system-text">{message.message}</span>
                                <span className="timestamp">{formatTimestamp(message.timestamp)}</span>
                            </div>
                        ) : (
                            <div className="message-content">
                                <div className="message-header">
                                    <span className="sender-name">
                                        {message.senderName} ({message.senderRole})
                                    </span>
                                    <span className="timestamp">{formatTimestamp(message.timestamp)}</span>
                                </div>
                                <div className="message-text">{message.message}</div>
                            </div>
                        )}
                    </div>
                ))}
                
                {/* Typing indicators */}
                {typingUsers.length > 0 && (
                    <div className="typing-indicator">
                        <span>{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...</span>
                    </div>
                )}
                
                <div ref={messagesEndRef} />
            </div>
            
            <form className="chat-input-form" onSubmit={handleSendMessage}>
                <input
                    type="text"
                    value={inputMessage}
                    onChange={handleInputChange}
                    placeholder="Type a message..."
                    className="chat-input"
                    maxLength={500}
                />
                <button 
                    type="submit" 
                    className="send-button"
                    disabled={inputMessage.trim() === ''}
                >
                    Send
                </button>
            </form>
        </div>
    );
};

export default ChatComponent;
