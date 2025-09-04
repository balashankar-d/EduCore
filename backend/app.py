from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from dateutil import parser
import uuid
import datetime
import jwt
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your_secret_key_here')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///ailearn.db')
db = SQLAlchemy(app)

# Remove RotatingFileHandler setup for file logging
# Logging will use default Flask console output

# Models
class Student(db.Model):
    student_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, unique=True, nullable=False)
    class_ = db.Column('class', db.Text)
    college = db.Column(db.Text)
    password_hash = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class Teacher(db.Model):
    teacher_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, unique=True, nullable=False)
    institution = db.Column(db.Text)
    password_hash = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class Class(db.Model):
    class_id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.Text)
    teacher_id = db.Column(db.Integer, db.ForeignKey('teacher.teacher_id'))
    target_class = db.Column(db.Text)
    institution_name = db.Column(db.Text)
    start_time = db.Column(db.DateTime)
    end_time = db.Column(db.DateTime)
    room_id = db.Column(db.String(36), default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class ChatMessage(db.Model):
    message_id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.String(36), nullable=False, index=True)
    sender_name = db.Column(db.String(255), nullable=False)
    sender_role = db.Column(db.String(20), nullable=False)  # 'teacher' or 'student'
    message_content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    is_system_message = db.Column(db.Boolean, default=False)  # For system notifications
    
    def to_dict(self):
        return {
            'id': self.message_id,
            'roomId': self.room_id,
            'senderName': self.sender_name,
            'senderRole': self.sender_role,
            'message': self.message_content,
            'timestamp': int(self.timestamp.timestamp() * 1000),  # Convert to milliseconds
            'isSystemMessage': self.is_system_message
        }

# JWT helper
def encode_auth_token(user_id, user_type, email):
    print('DEBUG SECRET_KEY (encode):', app.config['SECRET_KEY'])
    payload = {
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=1),
        'iat': datetime.datetime.utcnow(),
        'sub': str(user_id),  # Ensure subject is a string
        'type': user_type,
        'email': email
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token

def decode_auth_token(token):
    print('DEBUG SECRET_KEY (decode):', app.config['SECRET_KEY'])
    print('DEBUG token type:', type(token))
    print('DEBUG token repr:', repr(token))
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        print('DEBUG: Token expired')
        return None
    except jwt.InvalidTokenError as e:
        print('DEBUG: Invalid token:', str(e))
        return None

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.error(f"Unhandled Exception: {str(e)}", exc_info=True)
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    app.logger.warning(f"404 Not Found: {request.path}")
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(400)
def bad_request(e):
    app.logger.warning(f"400 Bad Request: {request.data}")
    return jsonify({'error': 'Bad request'}), 400

# Registration endpoints
@app.route('/register/student', methods=['POST'])
def register_student():
    try:
        data = request.json
        if not data or not all(k in data for k in ('name', 'email', 'password')):
            app.logger.warning('Student registration missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        if Student.query.filter_by(email=data['email']).first():
            app.logger.warning(f"Student registration duplicate email: {data['email']}")
            return jsonify({'error': 'Email already exists'}), 409
        hashed_pw = generate_password_hash(data['password'])
        student = Student(name=data['name'], email=data['email'], class_=data.get('class'), college=data.get('college'), password_hash=hashed_pw)
        db.session.add(student)
        db.session.commit()
        app.logger.info(f"Student registered: {data['email']}")
        return jsonify({'message': 'Student registered successfully.'}), 201
    except Exception as e:
        app.logger.error(f"Student registration error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Registration failed'}), 500

@app.route('/register/teacher', methods=['POST'])
def register_teacher():
    try:
        data = request.json
        if not data or not all(k in data for k in ('name', 'email', 'password')):
            app.logger.warning('Teacher registration missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        if Teacher.query.filter_by(email=data['email']).first():
            app.logger.warning(f"Teacher registration duplicate email: {data['email']}")
            return jsonify({'error': 'Email already exists'}), 409
        hashed_pw = generate_password_hash(data['password'])
        teacher = Teacher(name=data['name'], email=data['email'], institution=data.get('institution'), password_hash=hashed_pw)
        db.session.add(teacher)
        db.session.commit()
        app.logger.info(f"Teacher registered: {data['email']}")
        return jsonify({'message': 'Teacher registered successfully.'}), 201
    except Exception as e:
        app.logger.error(f"Teacher registration error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Registration failed'}), 500

# Login endpoints
@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.json
        print('DEBUG login payload:', data)
        if not data or not all(k in data for k in ('email', 'password')):
            app.logger.warning('Login missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        # Try student first
        user = Student.query.filter_by(email=data['email']).first()
        role = None
        if user and check_password_hash(user.password_hash, data['password']):
            role = 'student'
        else:
            # Try teacher
            user = Teacher.query.filter_by(email=data['email']).first()
            if user and check_password_hash(user.password_hash, data['password']):
                role = 'teacher'
        if role:
            token = encode_auth_token(user.student_id if role == 'student' else user.teacher_id, role, user.email)
            print('DEBUG login token:', token)
            app.logger.info(f"Login success: {data['email']} as {role}")
            return jsonify({'token': token, 'role': role, 'name': user.name}), 200
        app.logger.warning(f"Login failed: {data['email']}")
        return jsonify({'error': 'Invalid credentials'}), 401
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Login failed'}), 500

# Protected route example
@app.route('/classes', methods=['POST'])
def create_class():
    try:
        token = request.headers.get('Authorization')
        print('DEBUG token:', token)
        if token and token.startswith('Bearer '):
            token = token.split(' ', 1)[1]
        payload = decode_auth_token(token)
        print('DEBUG payload:', payload)
        if not payload or payload['type'] != 'teacher':
            app.logger.warning('Unauthorized class creation attempt')
            return jsonify({'error': 'Unauthorized'}), 401
        data = request.json
        if not data or not all(k in data for k in ('title', 'start_time', 'end_time')):
            app.logger.warning('Class creation missing fields')
            return jsonify({'error': 'Missing required fields'}), 400
        # Robust datetime parsing
        try:
            start_time = parser.isoparse(data['start_time'])
            end_time = parser.isoparse(data['end_time'])
        except Exception as dt_err:
            app.logger.error(f"Datetime parse error: {str(dt_err)}")
            return jsonify({'error': 'Invalid date format'}), 400
        new_class = Class(
            title=data['title'],
            teacher_id=payload['sub'],
            target_class=data.get('target_class'),
            institution_name=data.get('institution_name'),
            start_time=start_time,
            end_time=end_time
        )
        db.session.add(new_class)
        db.session.commit()
        app.logger.info(f"Class created: {data['title']} by teacher {payload['email']}")
        return jsonify({'message': 'Class created', 'room_id': new_class.room_id}), 201
    except Exception as e:
        app.logger.error(f"Class creation error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Class creation failed'}), 500

@app.route('/students', methods=['GET'])
def get_students():
    students = Student.query.all()
    return jsonify({'students': [
        {
            'student_id': s.student_id,
            'name': s.name,
            'email': s.email,
            'class': s.class_,
            'college': s.college,
            'created_at': s.created_at,
            'password_hash': s.password_hash,           
        } for s in students
    ]})

@app.route('/teachers', methods=['GET'])
def get_teachers():
    teachers = Teacher.query.all()
    return jsonify({'teachers': [
        {
            'teacher_id': t.teacher_id,
            'name': t.name,
            'email': t.email,
            'institution': t.institution,
            'created_at': t.created_at
        } for t in teachers
    ]})

@app.route('/classes', methods=['GET'])
def get_classes():
    class_ = request.args.get('class')
    institution = request.args.get('institution')
    query = Class.query
    if class_:
        query = query.filter_by(target_class=class_)
    if institution:
        query = query.filter_by(institution_name=institution)
    classes = query.all()
    return jsonify({'classes': [
        {
            'class_id': c.class_id,
            'title': c.title,
            'teacher_id': c.teacher_id,
            'target_class': c.target_class,
            'institution_name': c.institution_name,
            'start_time': c.start_time,
            'end_time': c.end_time,
            'room_id': c.room_id,
            'created_at': c.created_at
        } for c in classes
    ]})

@app.route('/students/me', methods=['GET'])
def get_student_me():
    token = request.headers.get('Authorization')
    if token and token.startswith('Bearer '):
        token = token.split(' ', 1)[1]
    payload = decode_auth_token(token)
    if not payload or payload['type'] != 'student':
        return jsonify({'error': 'Unauthorized'}), 401
    student = Student.query.filter_by(email=payload['email']).first()
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    return jsonify({
        'student_id': student.student_id,
        'name': student.name,
        'email': student.email,
        'class': student.class_,
        'college': student.college,
        'created_at': student.created_at
    })

# Chat API Endpoints
@app.route('/chat/messages/<room_id>', methods=['GET'])
def get_chat_messages(room_id):
    """Get chat message history for a room"""
    try:
        # Get pagination parameters
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)  # Default 50 messages per page
        
        # Query messages for the room, ordered by timestamp (oldest first for history)
        messages = ChatMessage.query.filter_by(room_id=room_id)\
                                  .order_by(ChatMessage.timestamp.asc())\
                                  .paginate(page=page, per_page=per_page, error_out=False)
        
        # Convert to dict format
        message_list = [msg.to_dict() for msg in messages.items]
        
        return jsonify({
            'success': True,
            'messages': message_list,
            'pagination': {
                'page': messages.page,
                'pages': messages.pages,
                'per_page': messages.per_page,
                'total': messages.total,
                'has_next': messages.has_next,
                'has_prev': messages.has_prev
            }
        })
        
    except Exception as e:
        app.logger.error(f"Error fetching chat messages: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': 'Failed to fetch messages'}), 500

@app.route('/chat/messages', methods=['POST'])
def save_chat_message():
    """Save a new chat message to the database"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['roomId', 'senderName', 'senderRole', 'message']
        if not data or not all(field in data for field in required_fields):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
        # Create new chat message
        chat_message = ChatMessage(
            room_id=data['roomId'],
            sender_name=data['senderName'],
            sender_role=data['senderRole'],
            message_content=data['message'].strip(),
            is_system_message=data.get('isSystemMessage', False)
        )
        
        # Save to database
        db.session.add(chat_message)
        db.session.commit()
        
        app.logger.info(f"Chat message saved: {data['senderName']} in room {data['roomId']}")
        
        # Return the saved message
        return jsonify({
            'success': True,
            'message': chat_message.to_dict()
        }), 201
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error saving chat message: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': 'Failed to save message'}), 500

@app.route('/chat/rooms/<room_id>/clear', methods=['DELETE'])
def clear_chat_history(room_id):
    """Clear all chat messages for a room (admin/teacher only)"""
    try:
        # Optional: Add authentication check here
        # For now, allowing any user to clear (you can add auth later)
        
        # Delete all messages for the room
        deleted_count = ChatMessage.query.filter_by(room_id=room_id).delete()
        db.session.commit()
        
        app.logger.info(f"Cleared {deleted_count} messages from room {room_id}")
        
        return jsonify({
            'success': True,
            'message': f'Cleared {deleted_count} messages',
            'deletedCount': deleted_count
        })
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error clearing chat history: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': 'Failed to clear chat history'}), 500

@app.route('/chat/rooms/<room_id>/stats', methods=['GET'])
def get_chat_stats(room_id):
    """Get chat statistics for a room"""
    try:
        total_messages = ChatMessage.query.filter_by(room_id=room_id).count()
        
        # Get unique participants
        participants = db.session.query(ChatMessage.sender_name, ChatMessage.sender_role)\
                                .filter_by(room_id=room_id)\
                                .distinct().all()
        
        # Get latest message timestamp
        latest_message = ChatMessage.query.filter_by(room_id=room_id)\
                                         .order_by(ChatMessage.timestamp.desc()).first()
        
        return jsonify({
            'success': True,
            'stats': {
                'totalMessages': total_messages,
                'participantCount': len(participants),
                'participants': [{'name': p.sender_name, 'role': p.sender_role} for p in participants],
                'latestMessageTime': int(latest_message.timestamp.timestamp() * 1000) if latest_message else None
            }
        })
        
    except Exception as e:
        app.logger.error(f"Error getting chat stats: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': 'Failed to get chat stats'}), 500
